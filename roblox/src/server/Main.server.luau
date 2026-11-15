--!strict
-- The Roblox server: runs the battle and tells every player what's happening.
--
-- Players don't get a Roblox avatar: each player IS an army. Their game sends
-- which way they steer ("Steer"); the server moves every army 30 times a
-- second and sends a snapshot of all armies and neutrals 15 times a second
-- ("Snapshot"), which each player's game draws. Shards only change now and
-- then, so players get the full list once ("ShardSync") and then just the
-- changes; each player also gets their own counts for the HUD ("Stats").

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Movement = require(Shared.Movement)
local Army = require(Shared.Army)
local PlayerArmy = require(Shared.PlayerArmy)
local Version = require(Shared.Version)
local Battlefield = require(script.Parent.Battlefield)
local Shards = require(script.Parent.Shards)
local Neutrals = require(script.Parent.Neutrals)

Players.CharacterAutoLoads = false
Battlefield.build()
Shards.create()
Neutrals.create()

-- Messages between the server and players.
local remotes = Instance.new("Folder")
remotes.Name = "Remotes"
local function remote(name: string): RemoteEvent
	local r = Instance.new("RemoteEvent")
	r.Name = name
	r.Parent = remotes
	return r
end
local steerRemote = remote("Steer")
local splitRemote = remote("Split")
local snapshotRemote = remote("Snapshot")
local shardRemote = remote("ShardSync")
local statsRemote = remote("Stats")
remotes.Parent = ReplicatedStorage

type Resources = {
	-- Total shards collected (the run score), and progress toward the next Warrior.
	shards: number,
	recruitProgress: number,
	-- Green crystals collected, and progress toward the next Archer.
	green: number,
	archerProgress: number,
}

type PlayerState = {
	army: PlayerArmy.PlayerArmy,
	-- Roblox streams the world to each player around their avatar; players here
	-- have none, so this invisible part follows their army and streaming centres
	-- on it instead (player.ReplicationFocus). Without it the battlefield never loads.
	focus: Part,
	steerX: number,
	steerZ: number,
	resources: Resources,
	-- Their HUD counts changed since they were last sent.
	statsDirty: boolean,
}

local states: { [Player]: PlayerState } = {}
local focusFolder = Instance.new("Folder")
focusFolder.Name = "StreamingFocus"
focusFolder.Parent = Workspace
local nextSoldierId = 1
local colorsUsed = 0
local spawnRng = Random.new()

local margin = Config.world.margin
local bounds: Movement.Bounds = {
	minX = margin,
	minZ = margin,
	maxX = Config.world.size - margin,
	maxZ = Config.world.size - margin,
}

-- A new soldier at (x, z) joins the army's nearest group.
local function newSoldier(state: PlayerState, x: number, z: number, role: Army.Role)
	Army.addSoldier(PlayerArmy.nearestCluster(state.army, x, z), nextSoldierId, x, z, role)
	nextSoldierId += 1
	state.statsDirty = true
end

-- A recruit appears close to the army's middle.
local function summon(state: PlayerState, role: Army.Role)
	local spread = Config.army.recruitSpread
	local c = state.army.lead
	newSoldier(state, c.x + spawnRng:NextNumber(-spread, spread), c.z + spawnRng:NextNumber(-spread, spread), role)
end

local function onPlayerAdded(player: Player)
	-- In Studio the player can join before this script runs and get an avatar; remove it.
	if player.Character then
		player.Character:Destroy()
	end
	colorsUsed += 1
	local colorIndex = (colorsUsed - 1) % #Config.colors + 1
	-- Start near the middle, a little apart from each other.
	local cx = Config.world.size / 2 + spawnRng:NextNumber(-120, 120)
	local cz = Config.world.size / 2 + spawnRng:NextNumber(-120, 120)
	local focus = Instance.new("Part")
	focus.Name = "Focus_" .. player.Name
	focus.Anchored = true
	focus.CanCollide = false
	focus.CanQuery = false
	focus.CanTouch = false
	focus.Transparency = 1
	focus.Size = Vector3.one
	focus.CFrame = CFrame.new(cx * Config.STUDS_PER_PX, 0, cz * Config.STUDS_PER_PX)
	focus.Parent = focusFolder
	player.ReplicationFocus = focus

	local state: PlayerState = {
		army = PlayerArmy.new(player.UserId, colorIndex, cx, cz),
		focus = focus,
		steerX = 0,
		steerZ = 0,
		resources = { shards = 0, recruitProgress = 0, green = 0, archerProgress = 0 },
		statsDirty = true,
	}
	states[player] = state
	for _ = 1, Config.army.startingSoldiers do
		newSoldier(state, cx, cz, "warrior")
	end
end

Players.PlayerAdded:Connect(onPlayerAdded)
for _, player in Players:GetPlayers() do
	onPlayerAdded(player)
end
Players.PlayerRemoving:Connect(function(player)
	local state = states[player]
	if state then
		state.focus:Destroy()
	end
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

-- SPACE from a player: split toward (x, z), where they point (zero = the way the army is heading).
splitRemote.OnServerEvent:Connect(function(player, x: unknown, z: unknown)
	local state = states[player]
	if not state or typeof(x) ~= "number" or typeof(z) ~= "number" or x ~= x or z ~= z then
		return
	end
	if PlayerArmy.split(state.army, os.clock(), x, z) > 0 then
		state.statsDirty = true
	end
end)

local function round1(value: number): number
	return math.round(value * 10) / 10
end

-- Shards as a flat list: { id, x, z, green (0/1), active (0/1), id, ... }.
local function packShards(list: { Shards.Shard }): { number }
	local flat = table.create(#list * 5)
	for _, s in list do
		table.insert(flat, s.id)
		table.insert(flat, round1(s.x))
		table.insert(flat, round1(s.z))
		table.insert(flat, if s.green then 1 else 0)
		table.insert(flat, if s.active then 1 else 0)
	end
	return flat
end

-- A player's game asks for every shard once it's ready to draw them.
shardRemote.OnServerEvent:Connect(function(player)
	shardRemote:FireClient(player, { full = true, shards = packShards(Shards.list) })
	local state = states[player]
	if state then
		state.statsDirty = true
	end
end)

--[[
	A snapshot: { t = server time, armies = { { id, color, cx, cz, soldiers =
	{ id, x, z, yaw, moving (0/1), archer (0/1), ... } } } }. Neutrals are sent
	as one more "army" with color 0. Kept flat and rounded so it stays small.
]]
local function packSoldier(flat: { number }, id: number, x: number, z: number, yaw: number, moving: boolean, archer: boolean)
	table.insert(flat, id)
	table.insert(flat, round1(x))
	table.insert(flat, round1(z))
	table.insert(flat, math.round(yaw * 100) / 100)
	table.insert(flat, if moving then 1 else 0)
	table.insert(flat, if archer then 1 else 0)
end

local function sendSnapshot()
	local armies = {}
	for _, state in states do
		local army = state.army
		local soldiers = PlayerArmy.allSoldiers(army)
		local flat = table.create(#soldiers * 6)
		for _, s in soldiers do
			packSoldier(flat, s.id, s.x, s.z, s.yaw, s.moving, s.role == "archer")
		end
		table.insert(armies, { id = army.id, color = army.colorIndex, cx = round1(army.lead.x), cz = round1(army.lead.z), soldiers = flat })
	end
	local neutrals = {}
	for _, n in Neutrals.list do
		if n.active then
			packSoldier(neutrals, n.id, n.x, n.z, n.yaw, n.moving, false)
		end
	end
	table.insert(armies, { id = 0, color = 0, cx = 0, cz = 0, soldiers = neutrals })
	snapshotRemote:FireAllClients({ t = Workspace:GetServerTimeNow(), armies = armies })
end

local function sendStats(player: Player, state: PlayerState)
	state.statsDirty = false
	local r = state.resources
	statsRemote:FireClient(player, {
		shards = r.shards,
		recruitProgress = r.recruitProgress,
		recruitCost = Config.army.recruitCost,
		green = r.green,
		archerProgress = r.archerProgress,
		archerCost = Config.army.archerCost,
		army = PlayerArmy.totalSoldiers(state.army),
		groups = #state.army.clusters,
		-- Seconds until the next group heads back (nil when whole or already regrouping).
		regroupIn = PlayerArmy.secondsUntilRegroup(state.army, os.clock()),
	})
end

-- Pick up shards and recruit neutrals with every soldier of one army.
local function collectAndRecruit(state: PlayerState, now: number, changedShards: { Shards.Shard })
	local soldiers = PlayerArmy.allSoldiers(state.army)
	if #soldiers == 0 then
		return
	end
	-- The box around the army: only shards and neutrals near it can be reached.
	local minX, minZ, maxX, maxZ = math.huge, math.huge, -math.huge, -math.huge
	for _, s in soldiers do
		minX, maxX = math.min(minX, s.x), math.max(maxX, s.x)
		minZ, maxZ = math.min(minZ, s.z), math.max(maxZ, s.z)
	end

	local nearby = Shards.activeNear(minX, minZ, maxX, maxZ)
	if #nearby > 0 then
		local blue, green = 0, 0
		for _, s in soldiers do
			local b, g = Shards.collectAt(s.x, s.z, now, nearby, changedShards)
			blue += b
			green += g
		end
		local r = state.resources
		-- Every few shards recruits a Warrior; every few green crystals, an Archer.
		for _ = 1, blue do
			r.shards += 1
			r.recruitProgress += 1
			if r.recruitProgress >= Config.army.recruitCost then
				r.recruitProgress -= Config.army.recruitCost
				summon(state, "warrior")
			end
		end
		for _ = 1, green do
			r.green += 1
			r.archerProgress += 1
			if r.archerProgress >= Config.army.archerCost then
				r.archerProgress -= Config.army.archerCost
				summon(state, "archer")
			end
		end
		if blue + green > 0 then
			state.statsDirty = true
		end
	end

	-- Neutrals join whoever reaches them first, right where they stood.
	if Neutrals.anyNear(minX, minZ, maxX, maxZ) then
		for _, s in table.clone(soldiers) do
			for _, unit in Neutrals.recruitNear(s.x, s.z, now) do
				newSoldier(state, unit.x, unit.z, "warrior")
			end
		end
	end
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
		local now = os.clock()
		local changedShards: { Shards.Shard } = {}
		local playerSpots: { Vector2 } = {}

		for _, state in states do
			local army = state.army
			if PlayerArmy.update(army, state.steerX, state.steerZ, STEP, now, bounds) > 0 then
				state.statsDirty = true
			end
			collectAndRecruit(state, now, changedShards)
			table.insert(playerSpots, Vector2.new(army.lead.x, army.lead.z))
		end

		Neutrals.update(now, STEP, playerSpots)
		Shards.update(now, playerSpots, changedShards)
		if #changedShards > 0 then
			shardRemote:FireAllClients({ full = false, shards = packShards(changedShards) })
		end

		if tick % Config.SNAPSHOT_EVERY == 0 then
			sendSnapshot()
			for player, state in states do
				-- While split, the regroup countdown changes all the time.
				if state.statsDirty or #state.army.clusters > 1 then
					sendStats(player, state)
				end
				-- Keep streaming centred on the army.
				local c = state.army.lead
				state.focus.CFrame = CFrame.new(c.x * Config.STUDS_PER_PX, 0, c.z * Config.STUDS_PER_PX)
			end
		end
	end
end)

print(`[{Version.name}] server ready, version {Version.version} ({#Shards.list} shards, {#Neutrals.list} neutrals)`)
