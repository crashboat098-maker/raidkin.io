--!strict
--[[
	Fallen soldiers, ported from the web's Fallen.ts. When a soldier dies it
	leaves a body behind:
	 - for the first few seconds it's dormant (nobody can take it),
	 - after that any army can revive it by walking a soldier up to it; it joins
	   that army at full health, in that army's colour,
	 - a body is claimed at most once, and unclaimed bodies fade away after a while.
	Players hear about bodies as changes (added / woke up / removed).
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage.Shared.Config)
local Army = require(ReplicatedStorage.Shared.Army)

local Fallen = {}

local settings = Config.fallen

export type Body = {
	id: number,
	x: number,
	z: number,
	yaw: number,
	-- The colour of the army it fell in (index into Config.colors).
	color: number,
	role: Army.Role,
	readyAt: number,
	expiresAt: number,
	awake: boolean,
}

-- What changed since the last time players were told.
export type Changes = { added: { Body }, awoken: { number }, removed: { number } }

local bodies: { [number]: Body } = {}
local nextId = 1
local nextExpiryCheck = 0
local readyCount = 0

Fallen.changes = { added = {}, awoken = {}, removed = {} } :: Changes

-- Take the changes collected so far (and start a fresh list).
function Fallen.takeChanges(): Changes
	local c = Fallen.changes
	Fallen.changes = { added = {}, awoken = {}, removed = {} }
	return c
end

function Fallen.all(): { [number]: Body }
	return bodies
end

-- A soldier fell here.
function Fallen.add(soldier: Army.Soldier, color: number, now: number)
	local body: Body = {
		id = nextId,
		x = soldier.x,
		z = soldier.z,
		yaw = soldier.yaw,
		color = color,
		role = soldier.role,
		readyAt = now + settings.dormant,
		expiresAt = now + settings.lifetime,
		awake = false,
	}
	nextId += 1
	bodies[body.id] = body
	table.insert(Fallen.changes.added, body)
end

local function remove(body: Body)
	if bodies[body.id] then
		bodies[body.id] = nil
		if body.awake then
			readyCount -= 1
		end
		table.insert(Fallen.changes.removed, body.id)
	end
end

-- Is any body recruitable right now?
function Fallen.anyRecruitable(): boolean
	return readyCount > 0
end

-- Recruitable bodies (for bots to look for).
function Fallen.recruitable(): { Body }
	local out = {}
	if readyCount > 0 then
		for _, body in bodies do
			if body.awake then
				table.insert(out, body)
			end
		end
	end
	return out
end

-- Claim every recruitable body within reach of (x, z). Claimed bodies are removed at once.
function Fallen.reviveNear(x: number, z: number, now: number): { Body }
	local found = {}
	if readyCount == 0 then
		return found
	end
	local r2 = settings.reviveRange ^ 2
	for _, body in bodies do
		if body.awake and now < body.expiresAt and (body.x - x) ^ 2 + (body.z - z) ^ 2 <= r2 then
			table.insert(found, body)
		end
	end
	for _, body in found do
		remove(body)
	end
	return found
end

-- Wake bodies whose dormant time is over, and remove ones that have lain unclaimed too long.
function Fallen.update(now: number)
	for _, body in bodies do
		if not body.awake and now >= body.readyAt then
			body.awake = true
			readyCount += 1
			table.insert(Fallen.changes.awoken, body.id)
		end
	end
	if now >= nextExpiryCheck then
		nextExpiryCheck = now + 1
		local expired = {}
		for _, body in bodies do
			if now >= body.expiresAt then
				table.insert(expired, body)
			end
		end
		for _, body in expired do
			remove(body)
		end
	end
end

return Fallen
