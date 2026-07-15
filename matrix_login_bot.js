// login_bot.js - Direct Production Token Fetcher

const botconfig = require('./matrix-config.json');
const os = require("os");

const match = botconfig.userId.match(/^@([^:]+)/);
if (!match) {
  console.error(`Invalid userId (${botconfig.userId}) in matrix-config.json file - must be of form @<userId>:<matrixorg>`);
  process.exit(1);
}
const USERNAME = match[1];
const PASSWORD = "notrealpassword";  // NOT THE REAL ONE
const DEVICE = os.hostname();
const BASE_URL = "https://matrix-client.matrix.org/_matrix/client/v3/login";

async function loginMatrixBot() {
    console.log("⏳ Logging bot directly into production matrix.org servers...");

    const response = await fetch(BASE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            type: "m.login.password",
            identifier: {
                type: "m.id.user",
                user: USERNAME // e.g. "mybotname" (do not include the @ or :matrix.org)
            },
            password: PASSWORD,
            device_id: DEVICE // Define a custom unique tracking name for your bot session
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        console.error(`❌ Authentication Status: ${response.status}`);
        console.error(`❌ Authentication Failed: ${errText}`);
        process.exit(1);
    }

    const data = await response.json();

    console.log("\n=======================================================");
    console.log("🎯 PRODUCTION TOKENS ACQUIRED SUCCESSFULLY!");
    console.log(`User ID:      ${data.user_id}`);
    console.log(`Access Token: ${data.access_token}`);
    console.log(`Device ID:   ${data.device_id}`);
    console.log("=======================================================\n");
    console.log("Save this Access Token string into your main bot script code!");
}

loginMatrixBot();

