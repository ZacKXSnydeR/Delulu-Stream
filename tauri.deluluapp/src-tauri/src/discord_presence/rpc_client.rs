use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::Mutex;
use super::models::PresenceData;

pub struct DiscordState {
    pub client: Mutex<Option<DiscordIpcClient>>,
}

impl DiscordState {
    pub fn new() -> Self {
        Self {
            client: Mutex::new(None),
        }
    }

    pub fn init(&self, app_id: &str) -> std::result::Result<(), String> {
        let mut client = DiscordIpcClient::new(app_id);
        match client.connect() {
            Ok(_) => {
                let mut guard = self.client.lock().unwrap();
                *guard = Some(client);
                println!("[Discord Presence] Connected to Discord RPC");
                Ok(())
            }
            Err(e) => {
                println!("[Discord Presence] Failed to connect: {}", e);
                // We don't return an error here because we want the app to silently
                // continue if Discord isn't running.
                Ok(())
            }
        }
    }

    pub fn set_presence(&self, data: PresenceData) -> std::result::Result<(), String> {
        let mut guard = self.client.lock().unwrap();
        if let Some(client) = guard.as_mut() {
            
            // Construct assets first
            let mut assets = activity::Assets::new();
            if let Some(ref li) = data.large_image {
                // Large image + hover text
                assets = assets.large_image(li).large_text("DELULU Streaming");
            }
            if let Some(ref si) = data.small_image {
                // Small image + hover text (usually overlays bottom right of large image)
                assets = assets.small_image(si).small_text("Watching");
            }

            // Construct main payload
            let mut payload = activity::Activity::new()
                .state(&data.state)
                .details(&data.title)
                .assets(assets); // Attach fully built assets

            if let Some(ts) = data.start_timestamp {
                payload = payload.timestamps(activity::Timestamps::new().start(ts));
            }
            
            // Add custom buttons
            let buttons = vec![
                activity::Button::new("Watch Together", "https://delulu.app/watch"),
                activity::Button::new("Open DELULU", "https://delulu.app"),
            ];
            payload = payload.buttons(buttons);

            match client.set_activity(payload) {
                Ok(_) => Ok(()),
                Err(e) => Err(e.to_string()),
            }
        } else {
            Err("Client not initialized".to_string())
        }
    }

    pub fn clear_presence(&self) -> std::result::Result<(), String> {
        let mut guard = self.client.lock().unwrap();
        if let Some(client) = guard.as_mut() {
            match client.clear_activity() {
                Ok(_) => Ok(()),
                Err(e) => Err(e.to_string()),
            }
        } else {
            Err("Client not initialized".to_string())
        }
    }
}
