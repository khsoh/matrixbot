const MatrixNotifier = require("./MatrixNotifier");
const notifier = new MatrixNotifier("./matrix-config.json");
const qrtxt = require('node:fs').readFileSync('./testqr.txt', 'utf8');

// Utility delay timer function
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function mainAppLoop() {
  console.log("System automation tracking metrics online...");

  // 1. Fire temporary session authorization token event block
  const alertInstance = await notifier.sendQrAlert(
    qrtxt,
    "CRITICAL: System incident report generated. This check-in entry card will self-destruct in 5 minutes."
  );

  if (alertInstance) {
    console.log(`Successfully dispatched alert. Tracking Event ID: ${alertInstance.eventId}`);

    // 2. Wait for your required operational automation window delay
    console.log("Waiting 5 minutes for administrative intervention window...");

    setTimeout(async () => {
      // 3. Execute the deletion using the explicit instance helper
      console.log("Executing automatic timeline cleanup protocol...");
      const deleted = await alertInstance.redact("Security token window lifetime expired.");

      if (deleted) {
        console.log("Element X room canvas wiped successfully.");
      }
    }, 1000*60*5);

  }
}

mainAppLoop();

// 2. Configure a persistent interval loop matching exactly 1 hour in milliseconds
// 60 minutes * 60 seconds * 1000 milliseconds = 3,600,000 ms
const ONE_HOUR = 60 * 60 * 1000;

setInterval(() => {
  // We fire the async function without 'await' here so that it runs in the background
  // and does not block Node's primary event loop loop structure.
  mainAppLoop();
}, ONE_HOUR);

