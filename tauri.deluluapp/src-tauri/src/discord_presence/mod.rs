pub mod models;
pub mod rpc_client;

use models::PresenceData;
pub use rpc_client::DiscordState;
use tauri::{command, State};

#[command]
pub fn presence_init(app_id: String, state: State<'_, DiscordState>) -> Result<(), String> {
    state.init(&app_id)
}

#[command]
pub fn presence_update(data: PresenceData, state: State<'_, DiscordState>) -> Result<(), String> {
    state.set_presence(data)
}

#[command]
pub fn presence_clear(state: State<'_, DiscordState>) -> Result<(), String> {
    state.clear_presence()
}
