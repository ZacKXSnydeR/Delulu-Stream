const { spawnSync } = require('child_process');
const path = require('path');

async function run() {
    const bypass = path.resolve(__dirname, 'bypass/bypass.js');
    console.log("Getting token via bypass...");
    const res = spawnSync("node", [bypass, "114922"]);
    const token = res.stdout.toString().trim();
    if (!token) {
        console.error("No token!", res.stderr.toString());
        return;
    }
    console.log("Token:", token);

    const url = `https://vidlink.pro/api/b/tv/${token}/1/1`;
    console.log("Fetching: " + url);
    const apiRes = await fetch(url, {
        headers: {
            "vidLink-Injected": "true",
            "Referer": "https://vidlink.pro/",
            "Origin": "https://vidlink.pro",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
    });

    const json = await apiRes.json();
    const streamUrl = json.stream[0].playlist;
    console.log("Raw Stream URL:", streamUrl);

    console.log("Curl fetching directly from storm CDN...");
    const curlRes = spawnSync("curl", [
        "-v",
        "-H", "Referer: https://vidlink.pro/",
        "-H", "Origin: https://vidlink.pro",
        "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        streamUrl
    ]);

    console.log("Curl stdout:", curlRes.stdout.toString().substring(0, 500));
    console.log("Curl stderr:", curlRes.stderr.toString());
}
run();
