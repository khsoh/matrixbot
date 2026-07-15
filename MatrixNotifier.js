const matrixSdk = require("matrix-js-sdk");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");

class MatrixNotifier {
  constructor(configFilePath) {
    this.configPath = path.resolve(configFilePath);
    this.loadConfig();

    // Initialize the Matrix Client with your permanent legacy token params
    this.client = matrixSdk.createClient({
      baseUrl: this.config.baseUrl,
      userId: this.config.userId,
      accessToken: this.config.accessToken // This long-lived token does not require refreshing
    });

    console.log("[Matrix Notifier] Core notification framework ready.");
  }

  /**
   * Reads and parses the local configuration JSON file
   */
  loadConfig() {
    if (!fs.existsSync(this.configPath)) {
      throw new Error(`Configuration file missing at path: ${this.configPath}`);
    }
    const rawData = fs.readFileSync(this.configPath, "utf8");
    this.config = JSON.parse(rawData);
  }

  /**
   * Generates a QR code image from a text string, uploads it directly
   * to the Matrix homeserver Media Repository, and broadcasts it to the target room.
   */
  async sendQrAlert(qrDataText, descriptionText) {
    try {
      // Generate the raw image buffer from the QR code library
      const dataUrl = await QRCode.toDataURL(qrDataText);
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
      const qrBuffer = Buffer.from(base64Data, 'base64');

      // Upload the buffer to Matrix Content Repository (MXC)
      const uploadResult = await this.client.uploadContent(qrBuffer, {
        type: "image/png",
        name: "automation_qr.png"
      });

      // Send the native image event
      const response = await this.client.sendEvent(this.config.targetRoomId, "m.room.message", {
        msgtype: "m.image",
        body: descriptionText,
        url: uploadResult.content_uri,
        filename: "automation_qr.png",
        info: {
          mimetype: "image/png",
          w: 250,
          h: 250
        },
        // MSC2530 markup hint for modern clients
        "m.relates.to": {
          "rel_type": "m.annotation",
          "key": descriptionText
        }
      });

      const eventId = response.event_id;
      console.log(`[Matrix Notifier] QR alert posted successfully. Event ID: ${eventId}`);

      return {
        eventId: eventId,
        redact: async (reason) => await this.redactQrAlert(eventId, reason)
      };
    } catch (err) {
      console.error("[Matrix Notifier] Failed to broadcast QR alert event:", err.message);
      return null;
    }
  }

  /**
   * Redacts an existing message event on the room timeline (useful for ephemeral alerts)
   */
  async redactQrAlert(eventId, reason = "Automated expiration cleanup") {
    try {
      if (!eventId) throw new Error("Missing targeted Event ID parameter string.");

      const response = await this.client.redactEvent(this.config.targetRoomId, eventId, null, { reason });
      console.log(`[Matrix Notifier] Event successfully redacted. Redaction ID: ${response.event_id}`);
      return true;
    } catch (err) {
      console.error("[Matrix Notifier] Failed to execute timeline redaction:", err.message);
      return false;
    }
  }
}

module.exports = MatrixNotifier;

