const matrixSdk = require("matrix-js-sdk");
const { logger } = require("matrix-js-sdk/lib/logger");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");
const { stdout, stderr } = require("process");
const util = require("util");

function gentsdate(epochTime, override_opts = {}) {
  const options = {
    ...{
      day: "2-digit",
      year: "numeric",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      fractionalSecondDigits: 3,
      timeZoneName: "long",
      timeZone: "Asia/Singapore",
    },
    ...override_opts,
  };
  const dtf = new Intl.DateTimeFormat("en-us", options);
  const pt = dtf.formatToParts(epochTime);
  const p = pt.reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}.${p.fractionalSecond} ${p.timeZoneName}`;
}

class TConsole extends console.Console {
  constructor(...args) {
    super(...args);
    this.tslog_tz = "Asia/Singapore";
  }
  set_tz(tz) {
    this.tslog_tz = tz;
  }
  tsdate() {
    return gentsdate(Date.now(), { timeZoneName: "short" });
  }
  log(data, ...args) {
    super.log(`${this.tsdate()} --- `, util.format(data, ...args));
  }
  warn(data, ...args) {
    super.warn(`${this.tsdate()} :::WARN::: `, util.format(data, ...args));
  }
  error(data, ...args) {
    super.error(`${this.tsdate()} ###ERROR### `, util.format(data, ...args));
  }
}
const dtcon = new TConsole({ stdout, stderr });
dtcon.set_tz("Asia/Singapore");

logger.info = function (...msg) {
  dtcon.log(`[Matrix-js-sdk INFO]: `, msg.join(" "));
};

logger.warn = function (...msg) {
  dtcon.warn(`[Matrix-js-sdk WARN]: `, msg.join(" "));
};

logger.error = function (...msg) {
  dtcon.error(`[Matrix-js-sdk ERROR]: `, msg.join(" "));
};

class MatrixNotifier {
  constructor(envFilePath = path.resolve(process.cwd(), ".env")) {
    this.envFilePath = path.resolve(envFilePath);
    this.loadConfig();

    // Initialize the Matrix Client with your permanent legacy token params
    this.client = matrixSdk.createClient({
      baseUrl: this.config.BASEURL,
      userId: this.config.USERID,
      accessToken: this.config.ACCESSTOKEN, // This long-lived token does not require refreshing
    });

    setInterval(
      async () => {
        await this.pingMatrix();
      },
      1000 * 60 * 15,
    );

    dtcon.log("[Matrix Notifier] Core notification framework ready.");
  }

  /**
   * Reads and parses the local configuration JSON file
   */
  loadConfig() {
    if (!fs.existsSync(this.envFilePath)) {
      throw new Error(`Environment file missing at path: ${this.envFilePath}`);
    }

    this.config ??= {}; // Initialize config if not yet initialized
    const result = require("dotenv").config({
      path: this.envFilePath,
      processEnv: this.config,
    });
    if (result.error) {
      throw new Error(
        `Failed to read/parse environment file ${this.envFilePath}: ${result.error}`,
      );
    }
  }

  async pingMatrix() {
    const profile = await this.client.getProfileInfo(this.config.USERID);
    dtcon.log(`[Matrix Notifier] Profile: ${JSON.stringify(profile, null, 2)}`);
  }

  /**
   * Generates a QR code image from a text string, uploads it directly
   * to the Matrix homeserver Media Repository, and broadcasts it to the target room.
   */
  async sendQrAlert(qrDataText, descriptionText, autodelete_ms = 0) {
    try {
      // Generate the raw image buffer from the QR code library
      const dataUrl = await QRCode.toDataURL(qrDataText);
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
      const qrBuffer = Buffer.from(base64Data, "base64");

      // Upload the buffer to Matrix Content Repository (MXC)
      const uploadResult = await this.client.uploadContent(qrBuffer, {
        type: "image/png",
        name: "automation_qr.png",
      });

      // Send the native image event
      const response = await this.client.sendEvent(
        this.config.TARGETROOMID,
        "m.room.message",
        {
          msgtype: "m.image",
          body: descriptionText,
          url: uploadResult.content_uri,
          filename: "automation_qr.png",
          info: {
            mimetype: "image/png",
            w: 250,
            h: 250,
          },
          // MSC2530 markup hint for modern clients
          "m.relates.to": {
            rel_type: "m.annotation",
            key: descriptionText,
          },
        },
      );

      const eventId = response.event_id;
      dtcon.log(
        `[Matrix Notifier] QR alert posted successfully. Event ID: ${eventId}`,
      );

      // Schedule deleting message
      if (autodelete_ms > 0) {
        setTimeout(async () => {
          await this.redactQrAlert(eventId);
        }, autodelete_ms);
      }
      return {
        eventId: eventId,
        redact: async (reason) => await this.redactQrAlert(eventId, reason),
      };
    } catch (err) {
      dtcon.error("[Matrix Notifier] Failed to send QR event:", err.message);
      return null;
    }
  }

  /**
   * Redacts an existing message event on the room timeline (useful for ephemeral alerts)
   */
  async redactQrAlert(eventId, reason = "Automated expiration cleanup") {
    try {
      if (!eventId) {
        throw new Error("Missing targeted Event ID parameter string.");
      }

      const response = await this.client.redactEvent(
        this.config.TARGETROOMID,
        eventId,
        null,
        { reason },
      );
      dtcon.log(
        `[Matrix Notifier] QR message successfully redacted.\n    Event ID: ${eventId}\n    Redaction ID: ${response.event_id}`,
      );
      return false;
    } catch (err) {
      dtcon.error(
        "[Matrix Notifier] Failed to execute timeline redaction:",
        err.message,
      );
      return false;
    }
  }
}

module.exports = MatrixNotifier;
