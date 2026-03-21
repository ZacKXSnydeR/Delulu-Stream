const { spawnSync } = require('child_process');

async function run() {
    console.log("Extracting fresh URL...");
    const bypass = require('path').resolve(__dirname, 'bypass/bypass.js');
    const res = spawnSync("..\\tauri.deluluapp\\src-tauri\\binaries\\gods_EYE-x86_64-pc-windows-msvc.exe", ["tv", "-i", "157744", "-s", "1", "-e", "1", "--json", "--bypass-path", bypass]);
    const out = res.stdout.toString();
    const err = res.stderr.toString();
    console.log("gods_EYE stderr:", err);
    console.log("gods_EYE output length:", out.length);
    let result;
    try {
        result = JSON.parse(out);
    } catch (e) {
        console.error("JSON Parse failed on:", out.substring(0, 100));
        return;
    }

    const streamUrl = result.streams[0].url;
    console.log("Fresh URL:", streamUrl);

    console.log("Fetching directly...");
    const directResp = await fetch(streamUrl, {
        headers: {
            "Referer": "https://vidlink.pro/",
            "Origin": "https://vidlink.pro",
            "User-Agent": "Mozilla/5.0"
        }
    });

    console.log("Direct status:", directResp.status);
    const directText = await directResp.text();
    console.log("Direct body starts with EXTM3U?", directText.startsWith("#EXTM3U"));
    console.log("Lines in direct body:", directText.split('\\n').length);
}
run();
