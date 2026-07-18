const matrixSdk = require("matrix-js-sdk");
const { logger } = require("matrix-js-sdk/lib/logger");
const { CryptoEvent } = require("matrix-js-sdk/lib/crypto-api/CryptoEvent");
const {
  VerifierEvent,
  VerificationPhase,
  VerificationRequestEvent,
} = require("matrix-js-sdk/lib/crypto-api/verification");
const QRCode = require("qrcode");
const { stdout, stderr } = require("process");
const util = require("util");
const os = require("os");
const path = require("path");

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

/**
 * A lightweight utility mapping browser localStorage features
 * to real files on a Linux VPS disk.
 */
function createNodeLocalStorage(storePath) {
  const fs = require("fs");
  if (!fs.existsSync(storePath)) {
    fs.mkdirSync(storePath, { recursive: true });
  }

  return {
    getItem: (key) => {
      const file = path.join(storePath, encodeURIComponent(key));
      return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    },
    setItem: (key, value) => {
      const file = path.join(storePath, encodeURIComponent(key));
      fs.writeFileSync(file, value, "utf8");
    },
    removeItem: (key) => {
      const file = path.join(storePath, encodeURIComponent(key));
      if (fs.existsSync(file)) fs.unlinkSync(file);
    },
    clear: () => {
      const files = fs.readdirSync(storePath);
      for (const file of files) {
        fs.unlinkSync(path.join(storePath, file));
      }
    },
  };
}

class MatrixNotifier {
  constructor() {
    this.loadConfig();
    this.isInitialized = false;
    this.isCryptoReady = false;

    // Point to a dedicated base-state data directory
    const storePath = path.join(process.cwd(), ".matrix_client_store");

    // Initialize the Matrix Client with your permanent legacy token params
    this.client = matrixSdk.createClient({
      baseUrl: this.config.BASEURL,
      userId: this.config.USERID,
      accessToken: this.config.ACCESSTOKEN, // This long-lived token does not require refreshing
      deviceId: os.hostname(),

      store: new matrixSdk.MemoryStore({
        localStorage: global.localStorage || createNodeLocalStorage(storePath),
      }),
      cryptoCallbacks: {
        getSecretStorageKey: async ({ keys }, name) => {
          dtcon.log(
            `[Matrix Notifier] Unlocking Secret Storage key ID: ${name || "default"}`,
          );
          const keyId = Object.keys(keys);
          if (!keyId || keyId.length === 0)
            throw new Error("No secret storage key requested by server.");

          const keyBackupKey = this.client.keyBackupKeyFromRecoveryKey(
            this.config.RECOVERYKEY,
          );
          return [keyId[0], keyBackupKey];
        },
      },
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
    const envKeys = [
      "BASEURL",
      "USERID",
      "TARGETROOMID",
      "ACCESSTOKEN",
      "PASSWORD",
      "RECOVERYKEY",
    ];
    this.config = {};

    envKeys.forEach((key) => {
      this.config[key] = process.env[key];
    });
  }

  async pingMatrix() {
    const profile = await this.client.getProfileInfo(this.config.USERID);
    dtcon.log(`[Matrix Notifier] Profile: ${JSON.stringify(profile, null, 2)}`);
  }

  async init() {
    if (this.isInitialized) {
      dtcon.log("[Matrix Notifier] Already initialized.");
      return;
    }

    try {
      const storagePath = path.join(process.cwd(), ".matrix_crypto_store");

      // 1. Initialize persistent storage engine on disk
      await this.client.initRustCrypto({
        useIndexedDB: false,
        cryptoStoreFactory: () => new matrixSdk.RustSdkCryptoStore(storagePath),
      });
      dtcon.log("[Matrix Notifier] Persistent Rust Crypto layer activated.");

      const crypto = this.client.getCrypto();

      // 2. Connect to and sync the key backup engine
      await crypto.checkKeyBackupAndEnable();
      dtcon.log("[Matrix Notifier] Server key backup engine enabled.");

      // 3. FIXED: Use the direct, string-mapped event namespace to catch phone verification triggers
      // this.client.on(
      //   CryptoEvent.VerificationRequestReceived,
      //   async (request) => {
      //     dtcon.log(
      //       `[Matrix Notifier] Hooked incoming handshake request from: ${request.otherUserId}`,
      //     );
      //
      //     try {
      //       // 1. Accept the incoming verification channel connection
      //       await request.accept();
      //       dtcon.log("[Matrix Notifier] Request channel accepted.");
      //
      //       // 2. Set up a listener for when the remote device switches to the SAS/Emoji phase
      //       request.on(VerificationRequestEvent.Change, async () => {
      //         if (request.phase == VerificationPhase.Ready) {
      //           this.IsCryptoReady = true;
      //         }
      //         // Check if the request lifecycle has advanced to the SAS verifier stage
      //         const verifier = request.verifier;
      //         if (verifier) {
      //           dtcon.log(
      //             "[Matrix Notifier] SAS Verifier object captured. Binding emoji hooks...",
      //           );
      //
      //           // 3. Capture the calculated verification emojis
      //           verifier.on(VerifierEvent.ShowSas, async (sas) => {
      //             dtcon.log(
      //               "====================================================",
      //             );
      //             dtcon.log(
      //               "[Matrix Notifier] HEADLESS SAS VERIFICATION MENU!",
      //             );
      //             dtcon.log(
      //               "Please look at your phone/desktop Element screen.",
      //             );
      //             dtcon.log("Confirm that these exact 7 text mappings match:");
      //             dtcon.log(
      //               "====================================================",
      //             );
      //
      //             const emojiString = sas.sas.emoji
      //               .map(
      //                 (e, idx) =>
      //                   `${idx + 1}. [${e.emoji}] ${e.description.toUpperCase()}`,
      //               )
      //               .join("\n");
      //
      //             dtcon.log(emojiString);
      //             dtcon.log(
      //               "====================================================",
      //             );
      //
      //             // Headlessly approve the bot's side of the verification
      //             await verifier.verify();
      //             dtcon.log(
      //               "[Matrix Notifier] Handshake approved. Hit 'They Match' on your phone/PC!",
      //             );
      //           });
      //
      //           verifier.on(VerifierEvent.Cancel, (error) => {
      //             dtcon.log(
      //               `[Matrix Notifier] Sequence cancelled by peer: ${error.message}`,
      //             );
      //           });
      //         }
      //       });
      //
      //       dtcon.log(
      //         "[Matrix Notifier] Waiting for you to choose 'Show Emojis' on your phone/PC client...",
      //       );
      //     } catch (err) {
      //       dtcon.log(
      //         `[Matrix Notifier] Error processing verification request: ${err.message}`,
      //       );
      //     }
      //   },
      // );

      // 4. Start background sync loop
      await this.client.startClient({ initialSyncLimit: 5 });

      return new Promise((resolve, reject) => {
        const onSync = async (state) => {
          if (state === "PREPARED") {
            this.isInitialized = true;
            dtcon.log("[Matrix Notifier] Client timeline sync completed.");

            // 5. Final fallback trust mapping verification
            const backupInfo = await crypto.getKeyBackupInfo();
            if (backupInfo) {
              const trustInfo = await crypto.isKeyBackupTrusted(backupInfo);
              if (trustInfo.trusted || trustInfo.matchesDecryptionKey) {
                this.isCryptoReady = true;
                dtcon.log(
                  "[Matrix Notifier] E2EE baseline successfully validated.",
                );
              }
            } else {
              this.isCryptoReady = true;
            }

            this.client.removeListener("sync", onSync);
            resolve();
          }
        };

        this.client.on("sync", onSync);
        setTimeout(() => {
          this.client.removeListener("sync", onSync);
          reject(new Error("Matrix client initial sync timed out"));
        }, 30000);
      });
    } catch (error) {
      dtcon.log(`[Matrix Notifier] Initialization failed: ${error.message}`);
      throw error;
    }
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
