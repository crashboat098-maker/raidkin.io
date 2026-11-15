--!strict
-- The Roblox server: runs the battle and tells every player what's happening.
--
-- Players don't get a Roblox avatar: each player IS an army. Their game sends
-- which way they steer ("Steer"); the server moves every army 30 times a
-- second and sends a snapshot of all armies 15 times a second ("Snapshot"),
-- which each player's game draws (see the client's ArmyView).

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Movement = require(Shared.Movement)
local Army = require(Shared.Army)
local Version = require(Shared.Version)
local Battlefield = require(script.Parent.Battlefield)

Players.CharacterAutoLoads = false
Battlefield.build()

-- Messages between the server and players.
local remotes = Instance.new("Folder")
remotes.Name = "Remotes"
local steerRemote = Instance.new("RemoteEvent")
steerRemote.Name = "Steer"
steerRemote.Parent = remotes
local snapshotRemote = Instance.new("RemoteEvent")
snapshotRemote.Name = "Snapshot"
snapshotRemote.Parent = remotes
remotes.Parent = ReplicatedStorage

type PlayerState = {
	army: Army.Army,
	steerX: number,
	steerZ: number,
}

local states: { [Player]: PlayerState } = {}
local nextSoldierId = 1
local colorsUsed = 0

local margin = Config.world.margin
local bounds: Movement.Bounds = {
	minX = margin,
	minZ = margin,
	maxX = Config.world.size - margin,
	maxZ = Config.world.size - margin,
}

local function onPlayerAdded(player: Player)
	-- In Studio the player can join before this script runs and get an avatar; remove it.
	if player.Character then
		player.Character:Destroy()
	end
	colorsUsed += 1
	local colorIndex = (colorsUsed - 1) % #Config.colors + 1
	-- Start near the middle, a little apart from each other.
	local rng = Random.new()
	local cx = Config.world.size / 2 + rng:NextNumber(-120, 120)
	local cz = Config.world.size / 2 + rng:NextNumber(-120, 120)
	local army = Army.new(player.UserId, colorIndex, cx, cz)
	for _ = 1, Config.army.startingSoldiers do
		Army.addSoldier(army, nextSoldierId, cx + rng:NextNumber(-20, 20), cz + rng:NextNumber(-20, 20))
		nextSoldierId += 1
	end
	states[player] = { army = army, steerX = 0, steerZ = 0 }
end

Players.PlayerAdded:Connect(onPlayerAdded)
for _, player in Players:GetPlayers() do
	onPlayerAdded(player)
end
Players.PlayerRemoving:Connect(function(player)
	states[player] = nil
end)

-- Steering from a player: a direction, at most 1 long. Anything else is ignored.
steerRemote.OnServerEvent:Connect(function(player, x: unknown, z: unknown)
	local state = states[player]
	if not state or typeof(x) ~= "number" or typeof(z) ~= "number" then
		return
	end
	if x ~= x or z ~= z then -- NaN
		return
	end
	local length = math.sqrt(x * x + z * z)
	if length > 1 then
		x /= length
		z /= length
	end
	state.steerX = x
	state.steerZ = z
end)

local function round1(value: number): number
	return math.round(value * 10) / 10
end

--[[
	A snapshot of every army: { t = server time, armies = { { id, color, cx, cz,
	soldiers = { id, x, z, yaw, moving (0/1), id, x, z, ... } } } }.
	Kept flat and rounded so it stays small.
]]
local function sendSnapshot()
	local armies = {}
	for _, state in states do
		local army = state.army
		local flat = table.create(#army.soldiers * 5)
		for _, s in army.soldiers do
			table.insert(flat, s.id)
			table.insert(flat, round1(s.x))
			table.insert(flat, round1(s.z))
			table.insert(flat, math.round(s.yaw * 100) / 100)
			table.insert(flat, if s.moving then 1 else 0)
		end
		table.insert(armies, {
			id = army.id,
			color = army.colorIndex,
			cx = round1(army.center.x),
			cz = round1(army.center.z),
			soldiers = flat,
		})
	end
	snapshotRemote:FireAllClients({ t = Workspace:GetServerTimeNow(), armies = armies })
end

-- The game loop: a fixed 30 updates a second, however fast the server's frames come.
local STEP = 1 / Config.TICK_HZ
local pending = 0
local tick = 0
RunService.Heartbeat:Connect(function(dt)
	pending = math.min(pending + dt, STEP * 4) -- never try to catch up more than 4 updates
	while pending >= STEP do
		pending -= STEP
		tick += 1
		for _, state in states do
			local army = state.army
			local speedShare = Army.speedMultiplier(#army.soldiers, Config.army.speedCurve, Config.army.minSpeedMultiplier)
			local tuning = {
				maxSpeed = Config.movement.maxSpeed * speedShare,
				acceleration = Config.movement.acceleration,
				deceleration = Config.movement.deceleration,
			}
			Movement.update(army.center, state.steerX, state.steerZ, STEP, tuning, bounds)
			Army.updateSoldiers(army, STEP, Config.army)
		end
		if tick % Config.SNAPSHOT_EVERY == 0 then
			sendSnapshot()
		end
	end
end)

print(`[{Version.name}] server ready, version {Version.version}`)
