# Raidkin on Roblox

The Roblox version of the game, written in Luau and synced into Roblox Studio
with [Rojo](https://rojo.space) 7.7.1.

| Folder | Becomes in Studio | Runs on |
|---|---|---|
| `src/shared` | `ReplicatedStorage.Shared` | server and players (game rules) |
| `src/server` | `ServerScriptService.Server` | the Roblox server |
| `src/client` | `StarterPlayer.StarterPlayerScripts.Client` | each player's game |

Rojo only manages those three folders; everything else in the place
(`Raidkin..rbxl` in Documents) is left alone.

## Working on it

1. Open the place in Roblox Studio.
2. Start syncing (from the repository folder):

   ```bash
   "%LOCALAPPDATA%\Programs\rojo\rojo.exe" serve roblox/default.project.json
   ```

3. In Studio: **Plugins** tab, **Rojo**, **Connect**. Edits to files here now
   show up in Studio straight away. Save the place in Studio to keep them in
   the `.rbxl` too.

Press **Play** in Studio: the Output window should show
`[Raidkin] server ready` and `[Raidkin] client ready`.
