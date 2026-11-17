--!strict
--[[
	Saved progress for each player, kept in a Roblox DataStore: total kills, the
	biggest army they've had, Crystal Arena wins, and the name and colour they
	last picked (the start screen remembers them). Shown in Roblox's player list
	as "leaderstats" (Kills, Best, Wins).

	Saved when a player leaves, when they're beaten, every minute, and when the
	server shuts down. If the DataStore can't be reached (e.g. in Studio without
	"Enable Studio Access to API Services"), the game still works; it just
	doesn't remember anything.
]]

local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")

local Profiles = {}

export type Profile = {
	kills: number,
	best: number,
	wins: number,
	name: string?,
	color: number?,
}

local STORE_NAME = "RaidkinProgress_v1"
local AUTOSAVE = 60

local store: DataStore? = nil
do
	local ok, result = pcall(function()
		return DataStoreService:GetDataStore(STORE_NAME)
	end)
	if ok then
		store = result
	else
		warn("[Profiles] saving is off: " .. tostring(result))
	end
end

local profiles: { [Player]: Profile } = {}
-- Whether loading worked (never overwrite a saved profile we couldn't read).
local loaded: { [Player]: boolean } = {}
local stats: { [Player]: { kills: IntValue, best: IntValue, wins: IntValue } } = {}

local function keyFor(player: Player): string
	return "player_" .. player.UserId
end

local function showStats(player: Player)
	local p, s = profiles[player], stats[player]
	if p and s then
		s.kills.Value = p.kills
		s.best.Value = p.best
		s.wins.Value = p.wins
	end
end

-- Load a player's progress (when they join), and set up their leaderstats.
function Profiles.load(player: Player): Profile
	local folder = Instance.new("Folder")
	folder.Name = "leaderstats"
	local function stat(name: string): IntValue
		local v = Instance.new("IntValue")
		v.Name = name
		v.Parent = folder
		return v
	end
	stats[player] = { kills = stat("Kills"), best = stat("Best"), wins = stat("Wins") }
	folder.Parent = player

	local profile: Profile = { kills = 0, best = 0, wins = 0, name = nil, color = nil }
	local ok = false
	local s = store
	if s then
		local success, data = pcall(function()
			return s:GetAsync(keyFor(player))
		end)
		ok = success
		if success and typeof(data) == "table" then
			profile.kills = tonumber(data.kills) or 0
			profile.best = tonumber(data.best) or 0
			profile.wins = tonumber(data.wins) or 0
			profile.name = if typeof(data.name) == "string" then data.name else nil
			profile.color = tonumber(data.color)
		elseif not success then
			warn("[Profiles] couldn't load " .. player.Name .. "'s progress: " .. tostring(data))
		end
	end
	profiles[player] = profile
	loaded[player] = ok
	showStats(player)
	return profile
end

-- Add to a player's totals (kills since last time, a new best army, an arena win).
function Profiles.add(player: Player, kills: number, army: number, wins: number)
	local p = profiles[player]
	if not p then
		return
	end
	p.kills += kills
	p.best = math.max(p.best, army)
	p.wins += wins
	showStats(player)
end

-- Remember the name and colour they picked.
function Profiles.setChoice(player: Player, name: string, color: number)
	local p = profiles[player]
	if p then
		p.name, p.color = name, color
	end
end

function Profiles.get(player: Player): Profile?
	return profiles[player]
end

function Profiles.save(player: Player)
	local s, p = store, profiles[player]
	if not s or not p or not loaded[player] then
		return
	end
	local ok, err = pcall(function()
		s:SetAsync(keyFor(player), { kills = p.kills, best = p.best, wins = p.wins, name = p.name, color = p.color })
	end)
	if not ok then
		warn("[Profiles] couldn't save " .. player.Name .. "'s progress: " .. tostring(err))
	end
end

-- Save and forget a player who left.
function Profiles.release(player: Player)
	Profiles.save(player)
	profiles[player] = nil
	loaded[player] = nil
	stats[player] = nil
end

-- Save everyone every minute, and when the server shuts down.
task.spawn(function()
	while true do
		task.wait(AUTOSAVE)
		for player in profiles do
			Profiles.save(player)
		end
	end
end)
game:BindToClose(function()
	for _, player in Players:GetPlayers() do
		Profiles.save(player)
	end
end)

return Profiles
