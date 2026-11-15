--!strict
--[[
	AI armies, ported from the web's BotBrain.ts. A bot plays by exactly the same
	rules as a player: all it produces is a steering direction, and collecting,
	recruiting and fighting happen through the normal rules. It re-thinks a few
	times a second. Each time it sizes up every army it knows about (strength =
	total remaining health) and picks the most pressing goal:

	  FLEE     a much stronger army is close (or we're hurt and it's not weaker)
	  HUNT     a clearly weaker army is in reach (big bots also search further)
	  FIGHT    a similar-sized army is close and we're healthy
	  RECRUIT  a neutral or a revivable body is near (small armies weigh this highest)
	  GATHER   a soul shard is near (staying away from threats)
	  RECOVER  hurt: keep away from everyone and gather until healed
	  EXPLORE  nothing better to do

	Chases that don't close the gap are dropped and that army ignored for a while,
	so a bot never chases an unreachable army forever. (Castles and the arena
	come with the real map.)
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage.Shared.Config)
local Army = require(ReplicatedStorage.Shared.Army)
local PlayerArmy = require(ReplicatedStorage.Shared.PlayerArmy)
local Combat = require(script.Parent.Combat)
local Map = require(script.Parent.Map)

local Bots = {}

local s = Config.bots
local rng = Random.new()

export type Mode = "explore" | "gather" | "recruit" | "hunt" | "fight" | "flee" | "recover"

type Pursuit = { rival: Combat.Fighter, bestDistance: number, lastImprovedAt: number }

export type BotState = {
	mode: Mode,
	-- Where it's heading (nil = standing still).
	target: Vector2?,
	nextDecisionAt: number,
	fleeUntil: number,
	-- When the steering point first reached the target (soldiers may still be on their way).
	leadArrivedAt: number?,
	lastProgressAt: number,
	lastProgressX: number,
	lastProgressZ: number,
	pursuit: Pursuit?,
	-- Armies it gave up chasing, and until when it ignores them.
	ignoreUntil: { [Combat.Fighter]: number },
	-- The army stops growing at this many soldiers (no more shards or recruits).
	maxSoldiers: number,
}

-- What a bot can see of the world.
export type View = {
	fighters: { Combat.Fighter },
	shards: { { active: boolean, x: number, z: number } },
	neutrals: { { active: boolean, x: number, z: number } },
	bodies: { { x: number, z: number } },
}

function Bots.newState(maxSoldiers: number): BotState
	return {
		mode = "explore",
		target = nil,
		nextDecisionAt = 0,
		fleeUntil = 0,
		leadArrivedAt = nil,
		lastProgressAt = 0,
		lastProgressX = 0,
		lastProgressZ = 0,
		pursuit = nil,
		ignoreUntil = {},
		maxSoldiers = maxSoldiers,
	}
end

-- Is this bot pulling back right now (its soldiers shouldn't chase)?
function Bots.isRetreating(state: BotState, now: number): boolean
	return state.mode == "flee" and now < state.fleeUntil
end

-- A target counts as reached when a soldier is this close (shard pickup radius is 12).
local REACHED_DISTANCE = 9
-- How long the steering point waits on a target for soldiers to catch up.
local ARRIVAL_PATIENCE = 1.5

local function dist(ax: number, az: number, bx: number, bz: number): number
	return math.sqrt((ax - bx) ^ 2 + (az - bz) ^ 2)
end

local function setTarget(state: BotState, x: number, z: number, now: number, fromX: number, fromZ: number)
	local old = state.target
	local changed = old == nil or dist(old.X, old.Y, x, z) > 24
	state.target = Vector2.new(x, z)
	if changed then
		state.leadArrivedAt = nil
		state.lastProgressAt = now
		state.lastProgressX, state.lastProgressZ = fromX, fromZ
	end
end

local function clampToWorld(x: number, z: number): (number, number)
	local m = Config.world.margin + 20
	return math.clamp(x, m, Config.world.size - m), math.clamp(z, m, Config.world.size - m)
end

local function nearest(points: { Vector2 }, fromX: number, fromZ: number, maxDistance: number): Vector2?
	local best: Vector2? = nil
	local bestDistance = maxDistance
	for _, p in points do
		local d = dist(p.X, p.Y, fromX, fromZ)
		if d < bestDistance then
			bestDistance = d
			best = p
		end
	end
	return best
end

type Rival = { fighter: Combat.Fighter, x: number, z: number, strength: number, distance: number }

-- Keep track of how a chase is going: false (and ignore that army a while) if the gap hasn't closed for too long.
local function trackPursuit(state: BotState, rival: Rival, now: number): boolean
	local p = state.pursuit
	if not p or p.rival ~= rival.fighter then
		state.pursuit = { rival = rival.fighter, bestDistance = rival.distance, lastImprovedAt = now }
		return true
	end
	if rival.distance < p.bestDistance - 15 or rival.distance < 40 then
		p.bestDistance = math.min(p.bestDistance, rival.distance)
		p.lastImprovedAt = now
		return true
	end
	if now - p.lastImprovedAt > s.pursuitGiveUp then
		state.ignoreUntil[rival.fighter] = now + s.pursuitIgnore
		state.pursuit = nil
		return false
	end
	return true
end

local function decide(bot: Combat.Fighter, state: BotState, view: View, now: number)
	local mine = PlayerArmy.allSoldiers(bot.army)
	if #mine == 0 then
		return
	end
	local mx, mz = Army.centroid(mine)
	local myStrength = Combat.strength(bot)
	local health = Combat.averageHealth(bot)
	local injured = health < s.injuredHealthRatio

	for f, untilT in state.ignoreUntil do
		if now >= untilT then
			state.ignoreUntil[f] = nil
		end
	end

	-- Size up every other living army.
	local rivals: { Rival } = {}
	for _, other in view.fighters do
		if other ~= bot and other.alive then
			local soldiers = PlayerArmy.allSoldiers(other.army)
			if #soldiers > 0 then
				local cx, cz = Army.centroid(soldiers)
				table.insert(rivals, { fighter = other, x = cx, z = cz, strength = Combat.strength(other), distance = dist(cx, cz, mx, mz) })
			end
		end
	end
	local visible = {}
	for _, r in rivals do
		if r.distance <= s.sightRadius then
			table.insert(visible, r)
		end
	end

	-- FLEE: a much stronger army close by, or any non-weaker one while we're hurt.
	-- (Keep fleeing until the flight time is up, so we actually get away.)
	if state.mode == "flee" and now < state.fleeUntil and state.target then
		return
	end
	local awayX, awayZ, threats = 0, 0, 0
	for _, r in visible do
		if r.strength >= myStrength * s.fleeRatio or (injured and r.strength >= myStrength * 0.8) then
			local d = math.max(1, r.distance)
			awayX += (mx - r.x) / d / d * 100 -- nearer threats push harder
			awayZ += (mz - r.z) / d / d * 100
			threats += 1
		end
	end
	if threats > 0 then
		local len = math.max(0.0001, math.sqrt(awayX ^ 2 + awayZ ^ 2))
		state.mode = "flee"
		state.fleeUntil = now + s.fleeDuration
		state.pursuit = nil
		local tx, tz = clampToWorld(mx + awayX / len * 220, mz + awayZ / len * 220)
		setTarget(state, tx, tz, now, mx, mz)
		return
	end

	-- HUNT: a clearly weaker army. Big bots also look beyond their sight.
	local searchRadius = if #mine >= s.huntMinSize then s.huntSearchRadius else s.sightRadius
	local prey: Rival? = nil
	local preyScore = -math.huge
	if not injured then
		for _, r in rivals do
			if r.distance <= searchRadius and not state.ignoreUntil[r.fighter] and myStrength >= r.strength * s.huntRatio then
				-- Prefer close, juicy targets.
				local score = r.strength / (r.distance + 60)
				if score > preyScore then
					preyScore = score
					prey = r
				end
			end
		end
	end
	if prey and trackPursuit(state, prey, now) then
		state.mode = "hunt"
		setTarget(state, prey.x, prey.z, now, mx, mz)
		return
	end

	-- FIGHT: a similar-sized army close by, while we're healthy.
	local peer: Rival? = nil
	if health >= 0.6 and #mine >= 3 then
		for _, r in visible do
			if not state.ignoreUntil[r.fighter] and myStrength >= r.strength * s.engageRatio and (peer == nil or r.distance < (peer :: Rival).distance) then
				peer = r
			end
		end
	end
	if peer and trackPursuit(state, peer, now) then
		state.mode = "fight"
		setTarget(state, peer.x, peer.z, now, mx, mz)
		return
	end
	state.pursuit = nil

	-- Everything else: grow the army, keeping clear of armies we shouldn't fight.
	local danger = {}
	for _, r in visible do
		if r.strength >= myStrength * s.engageRatio then
			table.insert(danger, r)
		end
	end
	local function safe(p: Vector2): boolean
		for _, d in danger do
			if dist(p.X, p.Y, d.x, d.z) <= 140 then
				return false
			end
		end
		return true
	end

	-- RECRUIT / GATHER. Small armies value recruits most. A full army leaves them for everyone else.
	local full = #mine >= state.maxSoldiers
	local recruits, shards = {}, {}
	if not full then
		for _, n in view.neutrals do
			local p = Vector2.new(n.x, n.z)
			if n.active and safe(p) then
				table.insert(recruits, p)
			end
		end
		for _, b in view.bodies do
			local p = Vector2.new(b.x, b.z)
			if safe(p) then
				table.insert(recruits, p)
			end
		end
		for _, sh in view.shards do
			local p = Vector2.new(sh.x, sh.z)
			if sh.active and safe(p) then
				table.insert(shards, p)
			end
		end
	end
	local recruit = nearest(recruits, mx, mz, s.sightRadius * 1.2)
	local shard = nearest(shards, mx, mz, s.sightRadius * 1.3)
	local recruitScore = if recruit then (if #mine < 10 then 2.2 else 1.4) / (dist(recruit.X, recruit.Y, mx, mz) + 40) else 0
	local shardScore = if shard then 1 / (dist(shard.X, shard.Y, mx, mz) + 40) else 0
	if recruit and recruitScore >= shardScore then
		state.mode = if injured then "recover" else "recruit"
		setTarget(state, recruit.X, recruit.Y, now, mx, mz)
		return
	end
	if shard then
		state.mode = if injured then "recover" else "gather"
		setTarget(state, shard.X, shard.Y, now, mx, mz)
		return
	end

	-- EXPLORE: keep the current exploration target, or pick a new one away from danger.
	if state.mode == "explore" and state.target then
		return
	end
	-- Somewhere on open ground (see Map), away from danger if we can.
	local wander = Vector2.new(mx, mz)
	for _ = 1, 8 do
		local wx, wz = Map.randomOpenSpot(rng)
		wander = Vector2.new(wx, wz)
		if safe(wander) then
			break
		end
	end
	setTarget(state, wander.X, wander.Y, now, mx, mz)
	state.mode = "explore"
end

-- Decide (if it's time) and return this update's steering direction for a bot.
function Bots.steer(bot: Combat.Fighter, state: BotState, view: View, now: number): (number, number)
	local lead = bot.army.lead
	if now >= state.nextDecisionAt then
		decide(bot, state, view, now)
		state.nextDecisionAt = now + s.decisionInterval * (0.8 + rng:NextNumber() * 0.4)
	end
	local target = state.target
	if not target then
		return 0, 0
	end

	-- Reached = a soldier stands on the spot (that's what picks things up). The
	-- steering point arriving isn't enough: soldiers trail a little behind it, so
	-- it nudges past the spot to walk them over it, and gives up after a moment.
	local closest: Army.Soldier? = nil
	local closestD = math.huge
	for _, soldier in PlayerArmy.allSoldiers(bot.army) do
		local d = dist(soldier.x, soldier.z, target.X, target.Y)
		if d < closestD then
			closestD = d
			closest = soldier
		end
	end
	local leadThere = dist(lead.x, lead.z, target.X, target.Y) < 10
	if leadThere and state.leadArrivedAt == nil then
		state.leadArrivedAt = now
	end
	local arrivedAt = state.leadArrivedAt
	if not closest or closestD < REACHED_DISTANCE or (leadThere and arrivedAt and now - arrivedAt > ARRIVAL_PATIENCE) then
		state.target = nil
		state.leadArrivedAt = nil
		state.nextDecisionAt = now -- pick something new right away
		return 0, 0
	end
	local gx, gz = target.X, target.Y
	if dist(lead.x, lead.z, target.X, target.Y) < 14 then
		local dx, dz = target.X - closest.x, target.Y - closest.z
		local d = math.max(1, math.sqrt(dx * dx + dz * dz))
		gx, gz = target.X + dx / d * 14, target.Y + dz / d * 14
	end

	-- Not getting anywhere (squeezed against the edge)? Give up on that target.
	if dist(lead.x, lead.z, state.lastProgressX, state.lastProgressZ) > 6 then
		state.lastProgressX, state.lastProgressZ = lead.x, lead.z
		state.lastProgressAt = now
	elseif now - state.lastProgressAt > 1.2 then
		state.lastProgressAt = now
		state.target = nil
		state.nextDecisionAt = now
		return 0, 0
	end

	local dx, dz = gx - lead.x, gz - lead.z
	local d = math.max(0.0001, math.sqrt(dx * dx + dz * dz))
	return dx / d, dz / d
end

return Bots
