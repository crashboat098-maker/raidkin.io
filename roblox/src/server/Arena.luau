--!strict
--[[
	The Crystal Arena, ported from the web's Arena.ts: a walled 1v1 battle ring
	in the crystal biome (bottom-left of the map).

	  OPEN       two entry zones outside the gates. An army alone in a zone for
	             qualifyTime qualifies (another army in the zone pauses it,
	             leaving resets it). One army can't hold both zones.
	  COUNTDOWN  both zones qualified: 3, 2, 1...
	  SPINNING   each contestant's Lucky Wheel spins to one of six equally likely
	             outcomes, +/-10, 20 or 30 soldiers (a loss never takes an army
	             below one soldier).
	  FIGHT      both armies are moved inside and fight with the normal combat
	             rules. Nobody else can get in, or hit them.
	  VICTORY    the last army standing wins; the loser is out. After a moment
	             the winner is let out past its gate...
	  COOLDOWN   ...and the arena rests before it opens again.

	The wall is a closed ring of solid blocks (already in the map's obstacles),
	so armies only ever go in or out by being moved (see Main's moveArmy).
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage.Shared.Config)
local Map = require(ReplicatedStorage.Shared.Map)
local PlayerArmy = require(ReplicatedStorage.Shared.PlayerArmy)
local Combat = require(script.Parent.Combat)

local Arena = {}

local settings = Config.arena
local rng = Random.new()

-- The wheel's six slices, in order around the wheel (equally likely).
Arena.OUTCOMES = { 10, -10, 20, -20, 30, -30 }

export type ZoneSite = {
	x: number,
	z: number,
	radius: number,
	-- Unit vector from the arena's centre out through this zone's gate.
	dirX: number,
	dirZ: number,
	-- Where this side's army starts inside, where the winner is let out, and where its wheel stands.
	insideX: number,
	insideZ: number,
	exitX: number,
	exitZ: number,
	wheelX: number,
	wheelZ: number,
}

export type Zone = {
	-- The army holding this zone (open phase), then the contestant.
	holder: Combat.Fighter?,
	-- Which life of the holder's army this is (an army beaten and started again is a new one).
	life: number,
	held: number,
	qualified: boolean,
	contested: boolean,
	-- This contestant's wheel (index into OUTCOMES), or nil before the spin.
	outcome: number?,
}

export type Phase = "open" | "countdown" | "spinning" | "fight" | "victory" | "cooldown"

export type Award = { fighter: Combat.Fighter, count: number }
export type Move = { fighter: Combat.Fighter, x: number, z: number, inside: boolean }

-- What Main has to do after an update.
export type Events = {
	awards: { Award },
	moves: { Move },
	-- Eliminate these armies (lost on time).
	forfeits: { Combat.Fighter },
	-- A match was won (winner nil: nobody left standing).
	finished: { winner: Combat.Fighter?, loser: Combat.Fighter? }?,
}

local data = Map.data.arena

-- The arena on this map, or nil (then everything here does nothing).
Arena.site = nil :: { x: number, z: number, radius: number, wall: number, zones: { ZoneSite } }?
if data and data.zones then
	local zones: { ZoneSite } = {}
	for _, z in data.zones do
		table.insert(zones, {
			x = z.x, z = z.y, radius = z.radius, dirX = z.dirX, dirZ = z.dirY,
			insideX = z.insideX, insideZ = z.insideY, exitX = z.exitX, exitZ = z.exitY,
			wheelX = z.wheelX, wheelZ = z.wheelY,
		})
	end
	Arena.site = { x = data.x, z = data.y, radius = data.radius, wall = data.wall, zones = zones }
end

local function newZone(): Zone
	return { holder = nil, life = 0, held = 0, qualified = false, contested = false, outcome = nil }
end

Arena.phase = "open" :: Phase
-- Seconds spent in the current phase.
Arena.phaseTime = 0
Arena.zones = { newZone(), newZone() }
-- Counts up per match (players' games use it to tell matches apart).
Arena.matchId = 0
Arena.winner = nil :: Combat.Fighter?

local sinceCheck = math.huge
local inside: { { [Combat.Fighter]: boolean } } = { {}, {} }

local function enter(phase: Phase)
	Arena.phase = phase
	Arena.phaseTime = 0
	for _, z in Arena.zones do
		z.contested = false
	end
end

local function reset(phase: Phase)
	if phase == "open" then
		Arena.winner = nil
	end
	Arena.zones = { newZone(), newZone() }
	inside = { {}, {} }
	sinceCheck = math.huge
	enter(phase)
end

-- The two armies in the current match (countdown onwards), or nil.
function Arena.contestants(): (Combat.Fighter?, Combat.Fighter?)
	if Arena.phase == "open" or Arena.phase == "cooldown" then
		return nil, nil
	end
	return Arena.zones[1].holder, Arena.zones[2].holder
end

-- False between a contestant and anyone else while a fight is on: no outside help or harm.
function Arena.canFight(a: Combat.Fighter, b: Combat.Fighter): boolean
	if Arena.phase ~= "fight" and Arena.phase ~= "victory" then
		return true
	end
	local x, y = Arena.contestants()
	if not x or not y then
		return true
	end
	local inA = a == x or a == y
	local inB = b == x or b == y
	return inA == inB
end

-- Is this army in the arena right now (fighting, or just won)? Bots and the
-- respawn code use this to leave it alone.
function Arena.isContestant(f: Combat.Fighter): boolean
	if Arena.phase ~= "fight" and Arena.phase ~= "victory" then
		return false
	end
	local x, y = Arena.contestants()
	return f == x or f == y
end

-- Which life an army is on (Main counts them up each time an army starts).
local function lifeOf(f: Combat.Fighter): number
	return (f :: any).lives or 0
end

-- Armies with a soldier in the zone (a quick box test skips armies far away).
local function armiesInZone(z: ZoneSite, fighters: { Combat.Fighter }): { [Combat.Fighter]: boolean }
	local found = {}
	local r2 = z.radius * z.radius
	for _, f in fighters do
		if f.alive then
			local lead = f.army.lead
			if math.abs(lead.x - z.x) <= z.radius + 600 and math.abs(lead.z - z.z) <= z.radius + 600 then
				for _, s in PlayerArmy.allSoldiers(f.army) do
					if (s.x - z.x) ^ 2 + (s.z - z.z) ^ 2 <= r2 then
						found[f] = true
						break
					end
				end
			end
		end
	end
	return found
end

local function count(set: { [Combat.Fighter]: boolean }): (number, Combat.Fighter?)
	local n, only = 0, nil
	for f in set do
		n += 1
		only = f
	end
	return n, only
end

-- Entry zones: qualify by holding a zone alone for qualifyTime.
local function updateOpen(dt: number, fighters: { Combat.Fighter })
	local site = Arena.site
	if not site then
		return
	end
	sinceCheck += dt
	if sinceCheck >= settings.checkInterval then
		sinceCheck = 0
		inside = { armiesInZone(site.zones[1], fighters), armiesInZone(site.zones[2], fighters) }
	end
	for i, z in Arena.zones do
		local here = inside[i]
		local other = Arena.zones[3 - i].holder
		local holder = z.holder
		if holder and (not here[holder] or not holder.alive or lifeOf(holder) ~= z.life) then
			z.holder, z.held, z.qualified = nil, 0, false
		end
		local n, only = count(here)
		if not z.holder and n == 1 and only and only ~= other then
			z.holder = only
			z.life = lifeOf(only)
		end
		z.contested = n > 1
		if z.holder and not z.contested and not z.qualified then
			z.held = math.min(settings.qualifyTime, z.held + dt)
			if z.held >= settings.qualifyTime then
				z.qualified = true
			end
		end
	end
	if Arena.zones[1].qualified and Arena.zones[2].qualified and Arena.zones[1].holder and Arena.zones[2].holder then
		Arena.matchId += 1
		enter("countdown")
	end
end

function Arena.update(dt: number, fighters: { Combat.Fighter }): Events
	local events: Events = { awards = {}, moves = {}, forfeits = {}, finished = nil }
	local site = Arena.site
	if not site then
		return events
	end
	local before = Arena.phaseTime
	Arena.phaseTime += dt
	-- Still in the match: alive, and the same life that qualified (not beaten and started again).
	local function alive(f: Combat.Fighter?): boolean
		if not f or not f.alive then
			return false
		end
		for _, z in Arena.zones do
			if z.holder == f then
				return lifeOf(f) == z.life
			end
		end
		return f.alive
	end
	local x, y = Arena.zones[1].holder, Arena.zones[2].holder

	-- A contestant gone (beaten, or left the game) before the fight: call it off.
	if (Arena.phase == "countdown" or Arena.phase == "spinning") and not (alive(x) and alive(y)) then
		reset("open")
		return events
	end

	if Arena.phase == "open" then
		updateOpen(dt, fighters)
	elseif Arena.phase == "countdown" then
		if Arena.phaseTime >= settings.countdownTime then
			for _, z in Arena.zones do
				z.outcome = rng:NextInteger(1, #Arena.OUTCOMES)
			end
			enter("spinning")
		end
	elseif Arena.phase == "spinning" then
		-- The wheels land: soldiers join or leave.
		if before < settings.spinTime and Arena.phaseTime >= settings.spinTime then
			for _, z in Arena.zones do
				local holder = z.holder
				if holder then
					table.insert(events.awards, { fighter = holder, count = Arena.OUTCOMES[z.outcome or 1] })
				end
			end
		end
		-- The gates open: both armies are moved inside.
		if Arena.phaseTime >= settings.spinTime + settings.resultTime then
			for i, z in Arena.zones do
				local holder = z.holder
				if holder then
					table.insert(events.moves, { fighter = holder, x = site.zones[i].insideX, z = site.zones[i].insideZ, inside = true })
				end
			end
			enter("fight")
		end
	elseif Arena.phase == "fight" then
		local xAlive, yAlive = alive(x), alive(y)
		if xAlive and yAlive and x and y then
			if Arena.phaseTime >= settings.maxFightTime then
				-- Too long: the bigger army wins, the other is out.
				local sx, sy = PlayerArmy.totalSoldiers(x.army), PlayerArmy.totalSoldiers(y.army)
				local loser = if sx == sy then (if rng:NextNumber() < 0.5 then x else y) elseif sx < sy then x else y
				table.insert(events.forfeits, loser)
			end
		else
			Arena.winner = if xAlive then x elseif yAlive then y else nil
			events.finished = { winner = Arena.winner, loser = if xAlive then y elseif yAlive then x else nil }
			enter("victory")
		end
	elseif Arena.phase == "victory" then
		if Arena.phaseTime >= settings.victoryTime then
			local winner = Arena.winner
			if winner and alive(winner) then
				for i, z in Arena.zones do
					if z.holder == winner then
						table.insert(events.moves, { fighter = winner, x = site.zones[i].exitX, z = site.zones[i].exitZ, inside = false })
					end
				end
			end
			reset("cooldown")
		end
	elseif Arena.phase == "cooldown" then
		if Arena.phaseTime >= settings.cooldownTime then
			reset("open")
		end
	end
	return events
end

return Arena
