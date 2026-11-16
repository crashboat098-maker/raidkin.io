--!strict
-- The Roblox server: runs the battle and tells every player what's happening.
--
-- Every army belongs to a "competitor": a player or a bot. Players don't get a
-- Roblox avatar: each player IS an army. Their game sends which way they steer
-- ("Steer"), when they split ("Split") and when they let a soldier go
-- ("Surrender"); bots steer themselves (see Bots).
-- The server moves every army 30 times a second, runs the fighting, and sends a
-- snapshot of all armies and neutrals 15 times a second ("Snapshot"). Shards
-- and fallen bodies change only now and then, so players get them once and then
-- just the changes ("ShardSync", "Bodies"). Each player also gets their own HUD
-- counts ("Stats"), everyone gets the scoreboard ("Board"), and a beaten
-- player is told ("Defeat") and can start again ("Respawn").

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
local Navigation = require(Shared.Navigation)
local Battlefield = require(script.Parent.Battlefield)
local Shards = require(script.Parent.Shards)
local Neutrals = require(script.Parent.Neutrals)
local Combat = require(script.Parent.Combat)
local Fallen = require(script.Parent.Fallen)
local Bots = require(script.Parent.Bots)
local Map = require(ReplicatedStorage.Shared.Map)
local Castles = require(script.Parent.Castles)
local Arena = require(script.Parent.Arena)

-- Arena duellists only fight each other: nobody outside helps or harms them.
Combat.canFight = Arena.canFight :: any

Players.CharacterAutoLoads = false
Battlefield.build()
-- Armies collide with the map's walls, buildings and trees, and wade slowly through water.
PlayerArmy.useObstacles(Map.obstacles)
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
local surrenderRemote = remote("Surrender")
local arenaRemote = remote("Arena")
local snapshotRemote = remote("Snapshot")
local shardRemote = remote("ShardSync")
local bodiesRemote = remote("Bodies")
local statsRemote = remote("Stats")
local boardRemote = remote("Board")
local defeatRemote = remote("Defeat")
local respawnRemote = remote("Respawn")
local castlesRemote = remote("Castles")
remotes.Parent = ReplicatedStorage

type Resources = {
	-- Total shards collected (the run score), and progress toward the next Warrior.
	shards: number,
	recruitProgress: number,
	-- Green crystals collected, and progress toward the next Archer.
	green: number,
	archerProgress: number,
}

type Competitor = {
	-- Unique per army (players and bots alike); players learn theirs from "Stats".
	id: number,
	name: string,
	colorIndex: number,
	army: PlayerArmy.PlayerArmy,
	-- Combat bookkeeping (see Combat.Fighter).
	lastCombatAt: number,
	holdBack: boolean,
	alive: boolean,
	-- Counts up each time the army (re)starts, so the arena can tell a beaten and
	-- restarted army from the one that qualified.
	lives: number,
	kills: number,
	steerX: number,
	steerZ: number,
	-- When it last let a soldier go (holding Q can't empty an army in a blink).
	lastSurrenderAt: number,
	resources: Resources,
	-- Biggest the army has been this life (shown when beaten).
	bestArmy: number,
	-- Their HUD counts changed since they were last sent.
	statsDirty: boolean,
	-- A player's: the player, and the invisible part streaming follows (see below).
	player: Player?,
	focus: Part?,
	-- A bot's: its brain, and when it comes back after being beaten.
	bot: Bots.BotState?,
	respawnAt: number?,
}

local competitors: { Competitor } = {}
local byPlayer: { [Player]: Competitor } = {}
local nextCompetitorId = 1
local nextSoldierId = 1
local rng = Random.new()

-- Roblox streams the world to each player around their avatar; players here
-- have none, so an invisible part follows their army and streaming centres on
-- it instead (player.ReplicationFocus). Without it the battlefield never loads.
local focusFolder = Instance.new("Folder")
focusFolder.Name = "StreamingFocus"
focusFolder.Parent = Workspace

local margin = Config.world.margin
local bounds: Movement.Bounds = {
	minX = margin,
	minZ = margin,
	maxX = Config.world.size - margin,
	maxZ = Config.world.size - margin,
}

-- ---------------------------------------------------------------------------
-- Armies coming and going
-- ---------------------------------------------------------------------------

local function maxHpOf(role: Army.Role): number
	if role == "archer" then
		return Config.combat.archer.maxHp
	elseif role == "guardian" then
		return Config.combat.guardian.maxHp
	end
	return Config.combat.maxHp
end

-- A new soldier at (x, z) joins the army's nearest group.
local function newSoldier(c: Competitor, x: number, z: number, role: Army.Role)
	Army.addSoldier(PlayerArmy.nearestCluster(c.army, x, z), nextSoldierId, x, z, role, maxHpOf(role))
	nextSoldierId += 1
	c.statsDirty = true
end

-- A spot at least spawnClearance from every other army (or the emptiest we can find).
local function spawnSpot(): (number, number)
	local bestX, bestZ, bestGap = Config.world.size / 2, Config.world.size / 2, -1
	for _ = 1, 40 do
		local x, z = Map.randomOpenSpot(rng)
		local gap = math.huge
		for _, other in competitors do
			if other.alive then
				gap = math.min(gap, math.sqrt((other.army.lead.x - x) ^ 2 + (other.army.lead.z - z) ^ 2))
			end
		end
		if gap >= Config.spawnClearance then
			return x, z
		end
		if gap > bestGap then
			bestX, bestZ, bestGap = x, z, gap
		end
	end
	return bestX, bestZ
end

-- (Re)start a competitor as a fresh army of startingSoldiers, somewhere safe.
local function startArmy(c: Competitor)
	local x, z = spawnSpot()
	c.army = PlayerArmy.new(c.id, c.colorIndex, x, z)
	c.alive = true
	c.lives += 1
	c.kills = 0
	c.lastCombatAt = 0
	c.holdBack = false
	c.steerX, c.steerZ = 0, 0
	c.resources = { shards = 0, recruitProgress = 0, green = 0, archerProgress = 0 }
	c.bestArmy = 0
	c.respawnAt = nil
	for _ = 1, Config.army.startingSoldiers do
		newSoldier(c, x, z, "warrior")
	end
	c.statsDirty = true
end

local function newCompetitor(name: string, colorIndex: number): Competitor
	local c: Competitor = {
		id = nextCompetitorId,
		name = name,
		colorIndex = colorIndex,
		army = PlayerArmy.new(nextCompetitorId, colorIndex, 0, 0),
		lastCombatAt = 0,
		holdBack = false,
		alive = false,
		lives = 0,
		kills = 0,
		steerX = 0,
		steerZ = 0,
		lastSurrenderAt = 0,
		resources = { shards = 0, recruitProgress = 0, green = 0, archerProgress = 0 },
		bestArmy = 0,
		statsDirty = true,
		player = nil,
		focus = nil,
		bot = nil,
		respawnAt = nil,
	}
	nextCompetitorId += 1
	table.insert(competitors, c)
	return c
end

-- The bots, each with its own colour and size limit.
for i, name in Config.bots.names do
	local c = newCompetitor(name, Config.bots.colors[i])
	c.bot = Bots.newState(Config.bots.maxSoldiers[i])
	startArmy(c)
end

-- Players get the colours the bots don't use, in join order.
local playerColors = {}
for i = 1, #Config.colors do
	if not table.find(Config.bots.colors, i) then
		table.insert(playerColors, i)
	end
end
local playersJoined = 0

local function onPlayerAdded(player: Player)
	-- In Studio the player can join before this script runs and get an avatar; remove it.
	if player.Character then
		player.Character:Destroy()
	end
	playersJoined += 1
	local c = newCompetitor(string.upper(player.DisplayName), playerColors[(playersJoined - 1) % #playerColors + 1])
	c.player = player
	local focus = Instance.new("Part")
	focus.Name = "Focus_" .. player.Name
	focus.Anchored = true
	focus.CanCollide = false
	focus.CanQuery = false
	focus.CanTouch = false
	focus.Transparency = 1
	focus.Size = Vector3.one
	focus.Parent = focusFolder
	player.ReplicationFocus = focus
	c.focus = focus
	byPlayer[player] = c
	startArmy(c)
end

Players.PlayerAdded:Connect(onPlayerAdded)
for _, player in Players:GetPlayers() do
	onPlayerAdded(player)
end
Players.PlayerRemoving:Connect(function(player)
	local c = byPlayer[player]
	if not c then
		return
	end
	byPlayer[player] = nil
	if c.focus then
		c.focus:Destroy()
	end
	table.remove(competitors, table.find(competitors, c) :: number)
end)

-- ---------------------------------------------------------------------------
-- Messages from players
-- ---------------------------------------------------------------------------

local function validNumbers(x: unknown, z: unknown): boolean
	return typeof(x) == "number" and typeof(z) == "number" and x == x and z == z
end

-- Steering: a direction, at most 1 long. Anything else is ignored.
steerRemote.OnServerEvent:Connect(function(player, x: unknown, z: unknown)
	local c = byPlayer[player]
	if not c or not validNumbers(x, z) then
		return
	end
	local sx, sz = x :: number, z :: number
	local length = math.sqrt(sx * sx + sz * sz)
	if length > 1 then
		sx /= length
		sz /= length
	end
	c.steerX, c.steerZ = sx, sz
end)

-- SPACE: split toward (x, z), where they point (zero = the way the army is heading).
splitRemote.OnServerEvent:Connect(function(player, x: unknown, z: unknown)
	local c = byPlayer[player]
	if c and c.alive and validNumbers(x, z) and PlayerArmy.split(c.army, os.clock(), x :: number, z :: number) > 0 then
		c.statsDirty = true
	end
end)

--[[
	Q or right-click: one soldier leaves the army toward (x, z), where they
	point (zero = the way the army is heading). The one furthest that way goes,
	walks a little further out, and turns neutral: anyone can recruit it (its old
	army too) once Config.fallen.dormant has passed. The last soldier stays.
]]
local SURRENDER_EVERY = 0.12
local function surrender(c: Competitor, aimX: number, aimZ: number, now: number): boolean
	local army = c.army
	if PlayerArmy.totalSoldiers(army) <= 1 then
		return false
	end
	local length = math.sqrt(aimX * aimX + aimZ * aimZ)
	local dx, dz = army.headingX, army.headingZ
	if length > 0.001 then
		dx, dz = aimX / length, aimZ / length
	elseif dx == 0 and dz == 0 then
		dx = 1
	end

	local fromX, fromZ = army.lead.x, army.lead.z
	local pickList: { Army.Soldier }? = nil
	local pickIndex = 0
	local best = -math.huge
	for _, ac in army.clusters do
		for i, s in ac.cluster.soldiers do
			local ahead = (s.x - fromX) * dx + (s.z - fromZ) * dz
			if ahead > best then
				best, pickList, pickIndex = ahead, ac.cluster.soldiers, i
			end
		end
	end
	if not pickList then
		return false
	end
	local s = table.remove(pickList, pickIndex) :: Army.Soldier
	local reach = Config.neutrals.surrenderDistance
	local toX, toZ = Navigation.findFreeSpotNear(Map.obstacles, bounds, s.x + dx * reach, s.z + dz * reach, 30)
	Neutrals.addSurrendered(s.x, s.z, toX or s.x, toZ or s.z, s.role, now + Config.fallen.dormant, math.atan2(-dx, -dz))
	return true
end

surrenderRemote.OnServerEvent:Connect(function(player, x: unknown, z: unknown)
	local c = byPlayer[player]
	local now = os.clock()
	if c and c.alive and validNumbers(x, z) and now - c.lastSurrenderAt >= SURRENDER_EVERY then
		c.lastSurrenderAt = now
		if surrender(c, x :: number, z :: number, now) then
			c.statsDirty = true
		end
	end
end)

-- PLAY AGAIN after being beaten.
respawnRemote.OnServerEvent:Connect(function(player)
	local c = byPlayer[player]
	if c and not c.alive then
		startArmy(c)
	end
end)

-- ---------------------------------------------------------------------------
-- Packing things up for players
-- ---------------------------------------------------------------------------

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

-- Bodies as a flat list: { id, x, z, yaw, color, awake (0/1), id, ... }.
local function packBodies(list: { Fallen.Body }): { number }
	local flat = table.create(#list * 6)
	for _, b in list do
		table.insert(flat, b.id)
		table.insert(flat, round1(b.x))
		table.insert(flat, round1(b.z))
		table.insert(flat, math.round(b.yaw * 100) / 100)
		table.insert(flat, b.color)
		table.insert(flat, if b.awake then 1 else 0)
	end
	return flat
end

-- A player's game asks for every shard and body once it's ready to draw them.
shardRemote.OnServerEvent:Connect(function(player)
	shardRemote:FireClient(player, { full = true, shards = packShards(Shards.list) })
	local all = {}
	for _, body in Fallen.all() do
		table.insert(all, body)
	end
	bodiesRemote:FireClient(player, { added = packBodies(all), awoken = {}, removed = {} })
	local c = byPlayer[player]
	if c then
		c.statsDirty = true
	end
end)

--[[
	A snapshot: { t = server time, armies = { { id, color, cx, cz (the steering point),
	speed (its top speed right now), soldiers =
	{ id, x, z, yaw, moving (0/1), role (0 Warrior, 1 Archer, 2 Guardian), health (0-100), ... } } } }.
	Neutrals are sent as one more "army" with id 0 and color 0. Kept flat and
	rounded so it stays small.
]]
-- How each class is sent to players.
local ROLE_CODE: { [Army.Role]: number } = { warrior = 0, archer = 1, guardian = 2 }

local function packSoldier(flat: { number }, id: number, x: number, z: number, yaw: number, moving: boolean, role: number, health: number)
	table.insert(flat, id)
	table.insert(flat, round1(x))
	table.insert(flat, round1(z))
	table.insert(flat, math.round(yaw * 100) / 100)
	table.insert(flat, if moving then 1 else 0)
	table.insert(flat, role)
	table.insert(flat, health)
end

local function sendSnapshot()
	local armies = {}
	for _, c in competitors do
		if c.alive then
			local soldiers = PlayerArmy.allSoldiers(c.army)
			local flat = table.create(#soldiers * 7)
			for _, s in soldiers do
				packSoldier(flat, s.id, s.x, s.z, s.yaw, s.moving, ROLE_CODE[s.role], math.ceil(s.hp / s.maxHp * 100))
			end
			table.insert(armies, { id = c.id, color = c.colorIndex, cx = round1(c.army.lead.x), cz = round1(c.army.lead.z), speed = round1(c.army.leadSpeed), soldiers = flat })
		end
	end
	local neutrals = {}
	for _, n in Neutrals.list do
		if n.active then
			packSoldier(neutrals, n.id, n.x, n.z, n.yaw, n.moving, ROLE_CODE[n.role], 100)
		end
	end
	table.insert(armies, { id = 0, color = 0, cx = 0, cz = 0, soldiers = neutrals })
	snapshotRemote:FireAllClients({ t = Workspace:GetServerTimeNow(), armies = armies })
end

local function sendStats(c: Competitor)
	c.statsDirty = false
	local player = c.player
	if not player then
		return
	end
	local r = c.resources
	statsRemote:FireClient(player, {
		myId = c.id,
		shards = r.shards,
		recruitProgress = r.recruitProgress,
		recruitCost = Config.army.recruitCost,
		green = r.green,
		archerProgress = r.archerProgress,
		archerCost = Config.army.archerCost,
		army = PlayerArmy.totalSoldiers(c.army),
		groups = #c.army.clusters,
		-- Seconds until the next group heads back (nil when whole or already regrouping).
		regroupIn = PlayerArmy.secondsUntilRegroup(c.army, os.clock()),
	})
end

-- A castle wheel's reward lands: `count` soldiers of `role` join the army, or (negative) random soldiers leave.
local function giveAward(c: Competitor, count: number, role: Army.Role)
	if count > 0 then
		local spread = Config.army.recruitSpread
		for _ = 1, count do
			local x, z = c.army.lead.x + rng:NextNumber(-spread, spread), c.army.lead.z + rng:NextNumber(-spread, spread)
			-- Never inside a wall: nudge to the nearest free spot (or the army's middle).
			if Map.obstacles.blockedAt(x, z, 3, 3) then
				x, z = c.army.lead.x, c.army.lead.z
			end
			newSoldier(c, x, z, role)
		end
	else
		for _ = 1, -count do
			local groups = {}
			for _, ac in c.army.clusters do
				if #ac.cluster.soldiers > 0 then
					table.insert(groups, ac.cluster)
				end
			end
			if #groups == 0 then
				break
			end
			local group = groups[rng:NextInteger(1, #groups)]
			table.remove(group.soldiers, rng:NextInteger(1, #group.soldiers))
		end
		c.statsDirty = true
	end
end

--[[
	The castles for players' games: where each one is, and its state: { name,
	x, z, radius, ready (0/1), cooldown (s), charger (army id, 0 = none),
	charged (s), contested (0/1), spin = { id, reward, elapsed, landed, by } or nil }.
]]
local function sendCastles()
	local list = {}
	for _, c in Castles.list do
		local spin = c.spin
		local charger = c.charger :: any
		local spinner = if spin then spin.fighter :: any else nil
		table.insert(list, {
			name = c.name,
			x = c.x,
			z = c.z,
			radius = c.radius,
			ready = if c.state == "ready" then 1 else 0,
			cooldown = math.ceil(c.cooldown),
			charger = if charger then charger.id else 0,
			charged = math.round(c.charged * 10) / 10,
			contested = if c.contested then 1 else 0,
			spin = if spin then { id = spin.id, reward = spin.rewardId, elapsed = spin.elapsed, landed = spin.landed, by = if spinner then spinner.id else 0 } else nil,
		})
	end
	castlesRemote:FireAllClients({ chargeTime = Config.castles.chargeTime, spinTime = Config.castles.spinTime, rewards = Castles.REWARDS, castles = list })
end

--[[
	Move a whole army to (x, z) at once (into the arena, or the winner back
	out), gathered into one group in formation. Inside the arena everyone is
	kept on its floor; outside, on open ground.
]]
local function moveArmy(c: Competitor, x: number, z: number, inside: boolean)
	local soldiers = PlayerArmy.allSoldiers(c.army)
	local army = PlayerArmy.new(c.id, c.colorIndex, x, z)
	local cluster = army.clusters[1].cluster
	local slots = Army.formationSlots(Config.army.formationSpacing, math.max(30, #soldiers))
	local site = Arena.site
	for i, s in soldiers do
		local slot = slots[i] or Vector2.zero
		local px, pz = x + slot.X, z + slot.Y
		if inside and site then
			local dx, dz = px - site.x, pz - site.z
			local d = math.sqrt(dx * dx + dz * dz)
			local max = site.radius - 12
			if d > max then
				px, pz = site.x + dx / d * max, site.z + dz / d * max
			end
		else
			local fx, fz = Navigation.findFreeSpotNear(Map.obstacles, bounds, px, pz, 40)
			if fx and fz then
				px, pz = fx, fz
			end
		end
		s.x, s.z, s.vx, s.vz = px, pz, 0, 0
		s.engageX, s.engageZ = nil, nil
		s.slot = i
		s.route = { mode = "slot", index = 1, points = nil }
		s.lastCheckX, s.lastCheckZ = px, pz
		s.wallTime = 0
	end
	cluster.soldiers = soldiers
	c.army = army
	c.statsDirty = true
end

--[[
	The arena for players' games: { phase, phaseTime, matchId, winner (army id),
	zones = { { holder (army id), held, qualified, contested, outcome } } }, plus
	the timings and wheel outcomes so the wheels can spin in step.
]]
local lastArenaPhase = ""
local function sendArena()
	if not Arena.site then
		return
	end
	local zones = {}
	for _, z in Arena.zones do
		local holder = z.holder :: any
		table.insert(zones, {
			holder = if holder then holder.id else 0,
			held = math.round(z.held * 10) / 10,
			qualified = if z.qualified then 1 else 0,
			contested = if z.contested then 1 else 0,
			outcome = z.outcome or 0,
		})
	end
	local winner = Arena.winner :: any
	arenaRemote:FireAllClients({
		phase = Arena.phase,
		phaseTime = math.round(Arena.phaseTime * 10) / 10,
		matchId = Arena.matchId,
		winner = if winner then winner.id else 0,
		zones = zones,
		qualifyTime = Config.arena.qualifyTime,
		countdownTime = Config.arena.countdownTime,
		spinTime = Config.arena.spinTime,
		cooldownTime = Config.arena.cooldownTime,
		outcomes = Arena.OUTCOMES,
	})
end

-- The scoreboard: every army, biggest first.
local function sendBoard()
	local rows = {}
	for _, c in competitors do
		table.insert(rows, {
			id = c.id,
			name = c.name,
			color = c.colorIndex,
			army = if c.alive then PlayerArmy.totalSoldiers(c.army) else 0,
			kills = c.kills,
			alive = c.alive,
		})
	end
	table.sort(rows, function(a, b)
		return a.army > b.army
	end)
	boardRemote:FireAllClients(rows)
end

-- ---------------------------------------------------------------------------
-- Collecting and recruiting
-- ---------------------------------------------------------------------------

-- How many more soldiers this army may take (bots stop at their limit; players never do).
local function roomToGrow(c: Competitor): number
	local bot = c.bot
	if not bot then
		return math.huge
	end
	return bot.maxSoldiers - PlayerArmy.totalSoldiers(c.army)
end

-- Pick up shards, recruit neutrals and revive bodies with every soldier of one army.
local function collectAndRecruit(c: Competitor, now: number, changedShards: { Shards.Shard })
	local soldiers = PlayerArmy.allSoldiers(c.army)
	if #soldiers == 0 or roomToGrow(c) <= 0 then
		return
	end
	-- The box around the army: only things near it can be reached.
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
		local r = c.resources
		-- Every few shards recruits a Warrior; every few green crystals, an Archer.
		for _ = 1, blue do
			r.shards += 1
			r.recruitProgress += 1
			if r.recruitProgress >= Config.army.recruitCost then
				r.recruitProgress -= Config.army.recruitCost
				local spread = Config.army.recruitSpread
				newSoldier(c, c.army.lead.x + rng:NextNumber(-spread, spread), c.army.lead.z + rng:NextNumber(-spread, spread), "warrior")
			end
		end
		for _ = 1, green do
			r.green += 1
			r.archerProgress += 1
			if r.archerProgress >= Config.army.archerCost then
				r.archerProgress -= Config.army.archerCost
				local spread = Config.army.recruitSpread
				newSoldier(c, c.army.lead.x + rng:NextNumber(-spread, spread), c.army.lead.z + rng:NextNumber(-spread, spread), "archer")
			end
		end
		if blue + green > 0 then
			c.statsDirty = true
		end
	end

	-- Neutrals and revivable bodies join whoever reaches them first, right where they stood.
	local neutralsNear = Neutrals.anyNear(minX, minZ, maxX, maxZ)
	local bodiesReady = Fallen.anyRecruitable()
	if neutralsNear or bodiesReady then
		for _, s in table.clone(soldiers) do
			if neutralsNear then
				for _, unit in Neutrals.recruitNear(s.x, s.z, now) do
					newSoldier(c, unit.x, unit.z, unit.role)
				end
			end
			if bodiesReady then
				for _, body in Fallen.reviveNear(s.x, s.z, now) do
					newSoldier(c, body.x, body.z, body.role)
				end
			end
		end
	end
end

-- ---------------------------------------------------------------------------
-- The game loop: a fixed 30 updates a second
-- ---------------------------------------------------------------------------

local STEP = 1 / Config.TICK_HZ

-- Every soldier standing in a lava river (not on a bridge) loses a little
-- health every burnInterval, from the moment it steps in. Only that soldier is
-- hurt, never the rest of its army. Returns whether anyone was burnt.
local function burnInLava(now: number): boolean
	local burnt = false
	for _, c in competitors do
		if c.alive then
			for _, s in PlayerArmy.allSoldiers(c.army) do
				if not Map.inLava(s.x, s.z) then
					s.nextBurnAt = 0
				else
					s.burningUntil = now + Config.lava.burnInterval
					if now >= s.nextBurnAt then
						s.hp -= Config.lava.burnDamage
						s.nextBurnAt = now + Config.lava.burnInterval
						burnt = true
					end
				end
			end
		end
	end
	return burnt
end
local pending = 0
local tick = 0

local function step(now: number)
	tick += 1
	local changedShards: { Shards.Shard } = {}
	local armySpots: { Vector2 } = {}
	local fighters = competitors :: { any }

	-- Bots that are due come back.
	for _, c in competitors do
		local respawnAt = c.respawnAt
		if c.bot and not c.alive and respawnAt and now >= respawnAt then
			startArmy(c)
		end
	end

	-- 1. Who steps out to fight whom (from where everyone stands now).
	Combat.assignEngagements(fighters)

	-- 2. Steer and move every army.
	local view: Bots.View = { fighters = fighters, shards = Shards.list, neutrals = Neutrals.list, bodies = Fallen.recruitable() }
	for _, c in competitors do
		if c.alive then
			local bot = c.bot
			if bot then
				c.holdBack = Bots.isRetreating(bot, now)
				c.steerX, c.steerZ = Bots.steer(c :: any, bot, view, now)
			end
			if PlayerArmy.update(c.army, c.steerX, c.steerZ, STEP, now, bounds) > 0 then
				c.statsDirty = true
			end
			table.insert(armySpots, Vector2.new(c.army.lead.x, c.army.lead.z))
		end
	end

	-- 3. Blows land and lava burns; the fallen leave bodies.
	local hits = Combat.resolveAttacks(fighters, now)
	local burnt = burnInLava(now)
	if #hits > 0 or burnt then
		for _, death in Combat.removeDead(fighters, hits) do
			local owner = death.owner :: any
			Fallen.add(death.soldier, owner.colorIndex, now)
			owner.statsDirty = true
		end
	end
	Combat.regenerate(fighters, now, STEP)

	-- 3b. Castles: charging circles, spinning wheels, rewards landing.
	local awards, spun = Castles.update(STEP, fighters)
	for _, award in awards do
		giveAward(award.fighter :: any, award.count, award.role)
	end
	if spun then
		sendCastles()
	end

	-- 3c. The arena: entry zones, countdown, wheels, the duel. Wheel rewards are
	-- Warriors or losses (never the last soldier); armies are moved in when the
	-- gates open, and the winner out.
	local arena = Arena.update(STEP, fighters)
	for _, award in arena.awards do
		local c = award.fighter :: any
		local count = math.max(award.count, -(PlayerArmy.totalSoldiers(c.army) - 1))
		if count ~= 0 then
			giveAward(c, count, "warrior")
		end
	end
	for _, move in arena.moves do
		moveArmy(move.fighter :: any, move.x, move.z, move.inside)
	end
	for _, loser in arena.forfeits do
		for _, ac in loser.army.clusters do
			table.clear(ac.cluster.soldiers)
		end
		(loser :: any).statsDirty = true
	end
	if Arena.phase ~= lastArenaPhase then
		lastArenaPhase = Arena.phase
		sendArena()
	end

	-- 4. Collect, recruit and revive.
	for _, c in competitors do
		if c.alive then
			collectAndRecruit(c, now, changedShards)
			c.bestArmy = math.max(c.bestArmy, PlayerArmy.totalSoldiers(c.army))
		end
	end

	-- 5. An army with no soldiers left is beaten: bots come back later, players are told.
	for _, c in competitors do
		if c.alive and PlayerArmy.totalSoldiers(c.army) == 0 then
			c.alive = false
			if c.bot then
				c.respawnAt = now + Config.bots.respawnDelay
			elseif c.player then
				defeatRemote:FireClient(c.player, { kills = c.kills, bestArmy = c.bestArmy, shards = c.resources.shards })
			end
		end
	end

	-- 6. The world: neutrals wander, shards and bodies come and go.
	Neutrals.update(now, STEP, armySpots)
	Shards.update(now, armySpots, changedShards)
	Fallen.update(now)

	-- 7. Tell players what changed.
	if #changedShards > 0 then
		shardRemote:FireAllClients({ full = false, shards = packShards(changedShards) })
	end
	local bodyChanges = Fallen.takeChanges()
	if #bodyChanges.added + #bodyChanges.awoken + #bodyChanges.removed > 0 then
		bodiesRemote:FireAllClients({ added = packBodies(bodyChanges.added), awoken = bodyChanges.awoken, removed = bodyChanges.removed })
	end
	if tick % Config.SNAPSHOT_EVERY == 0 then
		sendSnapshot()
		for _, c in competitors do
			-- While split, the regroup countdown changes all the time.
			if c.player and (c.statsDirty or #c.army.clusters > 1) then
				sendStats(c)
			end
			-- Keep streaming centred on the army.
			if c.focus then
				c.focus.CFrame = CFrame.new(c.army.lead.x * Config.STUDS_PER_PX, 0, c.army.lead.z * Config.STUDS_PER_PX)
			end
		end
	end
	if tick % 6 == 0 then
		sendCastles()
		sendArena()
	end
	if tick % 15 == 0 then
		sendBoard()
	end
end

RunService.Heartbeat:Connect(function(dt)
	pending = math.min(pending + dt, STEP * 4) -- never try to catch up more than 4 updates
	while pending >= STEP do
		pending -= STEP
		step(os.clock())
	end
end)

print(`[{Version.name}] server ready, version {Version.version} ({#Shards.list} shards, {#Neutrals.list} neutrals, {#Config.bots.names} bots)`)
