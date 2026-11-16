--!strict
-- An army: soldiers gathered in a round "sunflower" formation around an
-- invisible steering point that the player moves. Ported from the web's
-- Army.ts (one group, open ground; see PlayerArmy for splitting, and the
-- server's Combat for fighting).

local Movement = require(script.Parent.Movement)
local Obstacles = require(script.Parent.Obstacles)
local Navigation = require(script.Parent.Navigation)

local Army = {}

--[[
	How a soldier gets to its spot, cheapest first: straight to the spot when
	the way is clear; to the group's centre if something's in the way; back along
	the centre's recent path ("breadcrumbs", known to be walkable) if even that
	is blocked; and only if nothing is in sight, or it gets stuck, a small grid
	search for a detour. One shared trail per group is far cheaper than a
	pathfinder per soldier.
]]
export type Route = {
	mode: "slot" | "center" | "crumb" | "detour",
	-- Which breadcrumb (crumb) or waypoint (detour) it's heading for.
	index: number,
	points: { Vector2 }?,
}

-- Melee Warriors, Archers who keep to the back of the formation, and heavily
-- armoured Guardians who hold the front.
export type Role = "warrior" | "archer" | "guardian"

export type Soldier = {
	id: number,
	role: Role,
	-- Index of this soldier's spot in the formation.
	slot: number,
	x: number,
	z: number,
	vx: number,
	vz: number,
	-- Which way it faces (radians; Roblox yaw, so models can be turned with CFrame.Angles(0, yaw, 0)).
	yaw: number,
	moving: boolean,

	-- Combat (see the server's Combat).
	hp: number,
	maxHp: number,
	-- Earliest time this soldier can strike again (seconds, server clock).
	nextAttackAt: number,
	-- An enemy to step toward and fight this update (nil = keep formation).
	engageX: number?,
	engageZ: number?,
	-- Standing in lava: burns until this time (no healing meanwhile), and when it
	-- next takes a burn (0 = not in lava).
	burningUntil: number,
	nextBurnAt: number,

	-- Finding the way (see Route): the current plan and when to re-plan it, when
	-- it was last checked for being stuck (and where it was), and since when it's
	-- been badly separated from its group (0 = not).
	route: Route,
	nextThinkAt: number,
	nextStuckCheckAt: number,
	-- How long it has been pressing against a wall while trying to walk (seconds).
	wallTime: number,
	lastCheckX: number,
	lastCheckZ: number,
	lostSince: number,
}

export type Army = {
	id: number,
	colorIndex: number,
	center: Movement.Mover,
	soldiers: { Soldier },
	-- Direction of travel (unit vector).
	headingX: number,
	headingZ: number,
	-- The centre's recent positions, oldest first (breadcrumbs for soldiers who lose sight of it).
	trail: { Vector2 },
}

export type Settings = {
	formationSpacing: number,
	warriorSpeed: number,
	catchUpMultiplier: number,
	guardianSpeedMultiplier: number,
	warriorAcceleration: number,
	separationDistance: number,
	speedCurve: { { number } },
	minSpeedMultiplier: number,
}

-- Soldiers head straight for their spot: at least FOLLOW_BOOST times the
-- army's speed (so they keep pace with no lag), and FOLLOW_GAIN times the gap
-- when further off (so they catch up fast after a turn), never past it.
-- The same rule as the web game (and the original Raidkin).
local FOLLOW_BOOST = 1.45
local FOLLOW_GAIN = 3.5
-- Pressing against a wall this long (seconds) while trying to walk sends a soldier looking for a way round.
local WALL_STUCK = 0.25
-- A soldier this far from its spot counts as fallen behind and may run faster.
local FAR_BEHIND = 48
-- Fighting soldiers stop this close to their enemy (inside striking range).
local ENGAGE_STANDOFF = 8

-- ---------------------------------------------------------------------------
-- Formation
-- ---------------------------------------------------------------------------

local slotCache: { [number]: { Vector2 } } = {}

--[[
	Formation spots relative to the centre, in a "sunflower" spiral: the first
	soldier stands in the middle and each new one takes the next spot outward,
	so the army packs into an even, round, organic-looking blob as it grows.
]]
function Army.formationSlots(spacing: number, count: number): { Vector2 }
	local key = spacing * 1000 + count
	local cached = slotCache[key]
	if cached then
		return cached
	end

	local rng = Random.new(1234)
	local golden = math.pi * (3 - math.sqrt(5)) -- ~137.5 degrees
	local scale = spacing * 0.56
	local slots = { Vector2.zero }
	for i = 1, count - 1 do
		local radius = scale * math.sqrt(i + 1)
		local angle = i * golden
		-- A pixel or two of jitter keeps it from looking machine-made.
		table.insert(slots, Vector2.new(
			math.cos(angle) * radius + (rng:NextNumber() - 0.5) * 2,
			math.sin(angle) * radius * 0.9 + (rng:NextNumber() - 0.5) * 2
		))
	end
	slotCache[key] = slots
	return slots
end

-- How far behind the army's middle Archers stand.
local ARCHER_REAR = 10

-- An Archer's spot: its formation slot, moved back along the heading so it's at
-- least ARCHER_REAR behind the middle, with the Warriors between it and the enemy.
local function rearSlot(slot: Vector2, hx: number, hz: number): Vector2
	local ahead = slot.X * hx + slot.Y * hz
	if ahead <= -ARCHER_REAR then
		return slot
	end
	local back = ahead + ARCHER_REAR
	return Vector2.new(slot.X - hx * back, slot.Y - hz * back)
end

-- How far ahead of the army's middle Guardians stand.
local GUARDIAN_FRONT = 8

-- A Guardian's spot: moved forward so it's at least GUARDIAN_FRONT ahead of the
-- middle, shields between the enemy and everyone else.
local function frontSlot(slot: Vector2, hx: number, hz: number): Vector2
	local ahead = slot.X * hx + slot.Y * hz
	if ahead >= GUARDIAN_FRONT then
		return slot
	end
	local forward = GUARDIAN_FRONT - ahead
	return Vector2.new(slot.X + hx * forward, slot.Y + hz * forward)
end

-- The army's top speed share for its size, blended between the points of `curve`.
function Army.speedMultiplier(size: number, curve: { { number } }, minimum: number): number
	if #curve == 0 then
		return 1
	end
	if size <= curve[1][1] then
		return math.max(minimum, curve[1][2])
	end
	for i = 1, #curve - 1 do
		local a, b = curve[i], curve[i + 1]
		if size <= b[1] then
			local t = (size - a[1]) / (b[1] - a[1])
			return math.max(minimum, a[2] + (b[2] - a[2]) * t)
		end
	end
	return math.max(minimum, curve[#curve][2])
end

-- ---------------------------------------------------------------------------
-- Creating
-- ---------------------------------------------------------------------------

function Army.new(id: number, colorIndex: number, x: number, z: number): Army
	return {
		id = id,
		colorIndex = colorIndex,
		center = Movement.create(x, z),
		soldiers = {},
		headingX = 0,
		headingZ = 1,
		trail = {},
	}
end

-- Add a soldier at (x, z); it takes the first free formation spot (the outer edge).
function Army.addSoldier(army: Army, id: number, x: number, z: number, role: Role?, maxHp: number?): Soldier
	local used: { [number]: boolean } = {}
	for _, s in army.soldiers do
		used[s.slot] = true
	end
	local slot = 1
	while used[slot] do
		slot += 1
	end
	local hp = maxHp or 100
	local soldier: Soldier = {
		id = id,
		role = role or "warrior",
		slot = slot,
		x = x,
		z = z,
		vx = 0,
		vz = 0,
		yaw = 0,
		moving = false,
		hp = hp,
		maxHp = hp,
		nextAttackAt = 0,
		burningUntil = 0,
		nextBurnAt = 0,
		engageX = nil,
		engageZ = nil,
		route = { mode = "slot", index = 1, points = nil },
		nextThinkAt = 0,
		nextStuckCheckAt = 0,
		wallTime = 0,
		lastCheckX = x,
		lastCheckZ = z,
		lostSince = 0,
	}
	table.insert(army.soldiers, soldier)
	return soldier
end

-- Roughly how far a group of `count` soldiers reaches from its centre.
function Army.clusterRadius(count: number, spacing: number): number
	return if count <= 1 then 4 else spacing * 0.56 * math.sqrt(count) + 4
end

-- The average position of some soldiers.
function Army.centroid(soldiers: { Soldier }): (number, number)
	local x, z = 0, 0
	for _, s in soldiers do
		x += s.x
		z += s.z
	end
	local n = math.max(1, #soldiers)
	return x / n, z / n
end

--[[
	Give every soldier a fresh formation spot (after splitting or merging):
	inner spots first, each going to the closest soldier, so nobody has to
	cross the whole group.
]]
function Army.reassignSlots(army: Army, spacing: number)
	local count = #army.soldiers
	local slots = Army.formationSlots(spacing, math.max(30, count))
	local unassigned = table.clone(army.soldiers)
	for i = 1, count do
		local tx = army.center.x + slots[i].X
		local tz = army.center.z + slots[i].Y
		local bestIndex, best = 1, math.huge
		for k, s in unassigned do
			local d = (s.x - tx) ^ 2 + (s.z - tz) ^ 2
			if d < best then
				best = d
				bestIndex = k
			end
		end
		local soldier = table.remove(unassigned, bestIndex)
		if soldier then
			soldier.slot = i
			-- A new spot: plan a fresh way to it.
			soldier.route = { mode = "slot", index = 1, points = nil }
			soldier.nextThinkAt = 0
		end
	end
end

-- ---------------------------------------------------------------------------
-- Update
-- ---------------------------------------------------------------------------

-- Push away from very close neighbours (fine for small armies; a grid comes later).
local function separation(soldier: Soldier, others: { Soldier }, minDistance: number): (number, number)
	local px, pz = 0, 0
	local minSquared = minDistance * minDistance
	for _, other in others do
		if other ~= soldier then
			local dx = soldier.x - other.x
			local dz = soldier.z - other.z
			local d2 = dx * dx + dz * dz
			if d2 < minSquared then
				local d = math.sqrt(d2)
				if d < 0.01 then
					-- Exactly on top of each other: split using the id so they go different ways.
					px += ((soldier.id % 2) * 2 - 1) * 0.8
				else
					local amount = (minDistance - d) / minDistance * 0.8
					px += dx / d * amount
					pz += dz / d * amount
				end
			end
		end
	end
	return px, pz
end

-- Roblox yaw that turns a model (facing -Z) toward the direction (dx, dz).
local function yawToward(dx: number, dz: number): number
	return math.atan2(-dx, -dz)
end

-- ---------------------------------------------------------------------------
-- Finding the way (see the file comment on Route)
-- ---------------------------------------------------------------------------

-- Soldier detour searches allowed per update, across every army: a big battle
-- jams hundreds of soldiers at once, and searching for all of them in one update
-- would stall the server. The rest simply try again later.
local DETOUR_SEARCHES_PER_UPDATE = 3
-- A soldier's detour search gives up after this many grid cells.
local SOLDIER_DETOUR_VISITS = 2500
-- How often to check whether a travelling soldier is stuck, and how little movement counts as stuck.
local STUCK_CHECK = 0.9
local STUCK_DISTANCE = 4
-- Soldiers heading for the centre (not yet in formation) stop this close to it.
local CENTER_STANDOFF = 10
-- How often each soldier re-plans its route (seconds), staggered across soldiers.
local THINK_INTERVAL = 0.22
-- Breadcrumbs: the centre's recent path, one every TRAIL_SPACING px, the last TRAIL_LENGTH of them.
local TRAIL_SPACING = 10
local TRAIL_LENGTH = 200
-- A soldier this far from the centre for this long is put back near it (should be rare).
local RECOVER_DISTANCE = 260
local RECOVER_AFTER = 6

local detourBudgetAt = -1
local detourBudgetLeft = 0
local function takeDetourSearch(now: number): boolean
	if now ~= detourBudgetAt then
		detourBudgetAt = now
		detourBudgetLeft = DETOUR_SEARCHES_PER_UPDATE
	end
	if detourBudgetLeft <= 0 then
		return false
	end
	detourBudgetLeft -= 1
	return true
end

local function dist(ax: number, az: number, bx: number, bz: number): number
	return math.sqrt((ax - bx) ^ 2 + (az - bz) ^ 2)
end

-- Drop a breadcrumb where the centre is now (every TRAIL_SPACING px).
local function updateTrail(army: Army)
	local trail = army.trail
	local last = trail[#trail]
	if last and dist(last.X, last.Y, army.center.x, army.center.z) < TRAIL_SPACING then
		return
	end
	table.insert(trail, Vector2.new(army.center.x, army.center.z))
	if #trail > TRAIL_LENGTH then
		table.remove(trail, 1)
		-- Keep breadcrumb routes pointing at the same crumbs after the shift.
		for _, s in army.soldiers do
			if s.route.mode == "crumb" then
				s.route.index = math.max(1, s.route.index - 1)
			end
		end
	end
end

--[[
	Where a soldier's formation spot is right now. If the spot is inside an
	obstacle, pull it in toward the centre along the same line until it's free,
	so displaced soldiers don't all pile onto one point. (This is what makes a
	group squeeze through narrow gaps.)
]]
local function formationTarget(obs: Obstacles.Obstacles, bounds: Navigation.Bounds, cx: number, cz: number, sx: number, sz: number): (number, number)
	local function free(x: number, z: number): boolean
		return x >= bounds.minX and x <= bounds.maxX and z >= bounds.minZ and z <= bounds.maxZ and not obs.blockedAt(x, z, 3, 3)
	end
	if free(cx + sx, cz + sz) then
		return cx + sx, cz + sz
	end
	local t = 0.85
	while t > 0.1 do
		if free(cx + sx * t, cz + sz * t) then
			return cx + sx * t, cz + sz * t
		end
		t -= 0.15
	end
	local fx, fz = Navigation.findFreeSpotNear(obs, bounds, cx + sx, cz + sz, 28)
	if fx and fz then
		return fx, fz
	end
	return cx, cz
end

-- Choose the simplest route that works: straight to the spot, to the centre, along breadcrumbs, or (rarely) a detour.
local function planRoute(obs: Obstacles.Obstacles, bounds: Navigation.Bounds, soldier: Soldier, tx: number, tz: number, army: Army, now: number): Route
	local x, z = soldier.x, soldier.z
	local cx, cz = army.center.x, army.center.z
	if Navigation.hasDryPath(obs, x, z, tx, tz) then
		return { mode = "slot", index = 1, points = nil }
	end
	if Navigation.hasDryPath(obs, x, z, cx, cz) then
		return { mode = "center", index = 1, points = nil }
	end
	-- Already following a detour? Keep going rather than recomputing it.
	local current = soldier.route
	if current.mode == "detour" and current.points and current.index <= #current.points then
		return current
	end
	-- The newest breadcrumb we can walk straight to (newest = closest to the
	-- centre). A dry one first: the army's own footsteps lead over the bridge.
	local trail = army.trail
	local wetCrumb = -1
	for i = #trail, math.max(1, #trail - 39), -1 do
		local crumb = trail[i]
		if Navigation.hasClearPath(obs, x, z, crumb.X, crumb.Y) then
			if not Navigation.wadesBetween(obs, x, z, crumb.X, crumb.Y) then
				return { mode = "crumb", index = i, points = nil }
			end
			if wetCrumb < 0 then
				wetCrumb = i
			end
		end
	end
	-- No dry way: wading is fine.
	if Navigation.hasClearPath(obs, x, z, tx, tz) then
		return { mode = "slot", index = 1, points = nil }
	end
	if Navigation.hasClearPath(obs, x, z, cx, cz) then
		return { mode = "center", index = 1, points = nil }
	end
	if wetCrumb > 0 then
		return { mode = "crumb", index = wetCrumb, points = nil }
	end
	-- Nothing in sight: search a small grid for a way to the centre (if this update has searches left).
	if takeDetourSearch(now) then
		local detour = Navigation.findDetour(obs, bounds, x, z, cx, cz, SOLDIER_DETOUR_VISITS)
		if detour and #detour > 0 then
			return { mode = "detour", index = 1, points = detour }
		end
	end
	return { mode = "center", index = 1, points = nil }
end

-- ---------------------------------------------------------------------------
-- Update
-- ---------------------------------------------------------------------------

-- What each soldier needs to find its way (all optional: without them, open ground).
export type Ground = { obstacles: Obstacles.Obstacles, bounds: Navigation.Bounds, now: number }

--[[
	Move every soldier toward its spot around the group's centre. (The centre
	itself is moved separately.) With `ground`, soldiers find their way around
	obstacles; without it, they walk straight (open ground).
]]
function Army.updateSoldiers(army: Army, dt: number, settings: Settings, ground: Ground?)
	local center = army.center
	local obs = if ground then ground.obstacles else nil
	local now = if ground then ground.now else 0

	-- The formation turns the instant the army does.
	local centerSpeed = math.sqrt(center.vx * center.vx + center.vz * center.vz)
	if centerSpeed >= 10 then
		army.headingX = center.vx / centerSpeed
		army.headingZ = center.vz / centerSpeed
	end
	if ground then
		updateTrail(army)
	end

	local slots = Army.formationSlots(settings.formationSpacing, math.max(30, #army.soldiers))
	for _, soldier in army.soldiers do
		-- 1. Where should I be? (Archers keep to the rear; spots inside walls are pulled in.)
		local slot = slots[soldier.slot] or Vector2.zero
		if soldier.role == "archer" then
			slot = rearSlot(slot, army.headingX, army.headingZ)
		elseif soldier.role == "guardian" then
			slot = frontSlot(slot, army.headingX, army.headingZ)
		end
		local tx, tz = center.x + slot.X, center.z + slot.Y
		if ground then
			tx, tz = formationTarget(ground.obstacles, ground.bounds, center.x, center.z, slot.X, slot.Y)
		end

		-- 2. How do I get there? (Re-planned a few times a second, staggered.)
		if ground and now >= soldier.nextThinkAt then
			soldier.route = planRoute(ground.obstacles, ground.bounds, soldier, tx, tz, army, now)
			soldier.nextThinkAt = now + THINK_INTERVAL * (0.75 + ((soldier.id * 37) % 50) / 100)
		end
		local route = soldier.route
		local gx, gz = tx, tz
		local arriving = true
		if route.mode == "center" then
			gx, gz, arriving = center.x, center.z, false
		elseif route.mode == "crumb" then
			local crumb = army.trail[route.index]
			gx, gz, arriving = if crumb then crumb.X else center.x, if crumb then crumb.Y else center.z, false
			-- Reached a breadcrumb? On to the next one (and look for a shortcut).
			if dist(soldier.x, soldier.z, gx, gz) < 6 then
				if route.index < #army.trail then
					route.index += 1
				else
					soldier.route = { mode = "center", index = 1, points = nil }
				end
				soldier.nextThinkAt = now
			end
		elseif route.mode == "detour" then
			local points = route.points or {}
			local point = points[route.index]
			gx, gz, arriving = if point then point.X else center.x, if point then point.Y else center.z, false
			if dist(soldier.x, soldier.z, gx, gz) < 6 then
				route.index += 1
				if route.index > #points then
					soldier.route = { mode = "center", index = 1, points = nil }
					soldier.nextThinkAt = now
				end
			end
		end
		local slotDistance = dist(tx, tz, soldier.x, soldier.z)

		-- In a fight, step toward the enemy instead (Combat keeps this close to the spot).
		local ex, ez = soldier.engageX, soldier.engageZ
		local engaged = ex ~= nil and ez ~= nil
		if ex and ez then
			gx, gz, arriving = ex, ez, false
		end
		local toX, toZ = gx - soldier.x, gz - soldier.z
		local distance = math.sqrt(toX * toX + toZ * toZ)

		-- 3. How fast? Straight to my spot without overshooting it (see FOLLOW_BOOST),
		-- or to striking distance from the enemy, or a step short of the centre.
		local terrain = if obs then obs.speedFactorAt(soldier.x, soldier.z) else 1
		local roleSpeed = if soldier.role == "guardian" then settings.guardianSpeedMultiplier else 1
		local topSpeed = settings.warriorSpeed * roleSpeed * (if slotDistance > FAR_BEHIND then settings.catchUpMultiplier else 1) * terrain
		local speed = topSpeed
		if engaged then
			speed = if distance < ENGAGE_STANDOFF then 0 else math.min(topSpeed, (distance - ENGAGE_STANDOFF) * 6 + 12)
		elseif arriving then
			speed = math.min(distance / math.max(dt, 1e-4), math.max(topSpeed, centerSpeed * FOLLOW_BOOST, distance * FOLLOW_GAIN))
		elseif soldier.route.mode == "center" then
			speed = if distance < CENTER_STANDOFF then 0 else math.min(topSpeed, (distance - CENTER_STANDOFF) * 5 + 10)
		end
		local desiredX = if distance > 0.01 then toX / distance * speed else 0
		local desiredZ = if distance > 0.01 then toZ / distance * speed else 0

		-- 4. Personal space: a nudge apart only when soldiers actually overlap; weaker
		-- while travelling or fighting, so soldiers can pass gaps in single file and press in.
		local pushX, pushZ = separation(soldier, army.soldiers, settings.separationDistance)
		local push = if arriving then 0.6 else 0.25
		desiredX += pushX * topSpeed * push
		desiredZ += pushZ * topSpeed * push

		-- 5. Turn to the desired direction at once; only the speed eases. Move.
		-- Walking into a wall, the blocked part of the step slides along it toward
		-- the goal (head-on: half the soldiers go each way), so nobody stands
		-- pressing into a wall.
		soldier.vx, soldier.vz = Movement.steerVelocity(soldier.vx, soldier.vz, desiredX, desiredZ, settings.warriorAcceleration * dt)
		local hitWall = false
		if obs then
			local stepX, stepZ = soldier.vx * dt, soldier.vz * dt
			local x, z, blockedX, blockedZ = obs.move(soldier.x, soldier.z, 3, 3, stepX, stepZ)
			hitWall = blockedX or blockedZ
			if hitWall and not engaged and distance > 2 and blockedX ~= blockedZ then
				local side = if soldier.id % 2 == 0 then 1 else -1
				local alongX, alongZ = 0, 0
				if blockedX then
					alongZ = (if math.abs(toZ) > 2 then math.sign(toZ) else side) * math.abs(stepX)
				else
					alongX = (if math.abs(toX) > 2 then math.sign(toX) else side) * math.abs(stepZ)
				end
				local sx, sz, slidBlockedX, slidBlockedZ = obs.move(x, z, 3, 3, alongX, alongZ)
				x, z = sx, sz
				blockedX = blockedX or slidBlockedX
				blockedZ = blockedZ or slidBlockedZ
			end
			soldier.x, soldier.z = x, z
			if blockedX then
				soldier.vx = 0
			end
			if blockedZ then
				soldier.vz = 0
			end
		else
			soldier.x += soldier.vx * dt
			soldier.z += soldier.vz * dt
		end

		-- 6. Fighters face their foe; marching soldiers all face the way the army is
		-- steered, the instant it turns; otherwise they face the way they walk.
		local ownSpeed = math.sqrt(soldier.vx * soldier.vx + soldier.vz * soldier.vz)
		if engaged and distance > 0.01 then
			soldier.yaw = yawToward(toX, toZ)
		elseif centerSpeed > 3 then
			soldier.yaw = yawToward(center.vx, center.vz)
		elseif ownSpeed > 3 then
			soldier.yaw = yawToward(soldier.vx, soldier.vz)
		end
		soldier.moving = ownSpeed > 8

		if ground then
			-- Held up by a wall for a moment (its spot or the next breadcrumb is round a
			-- corner it can't slide past)? Search for a way round right away.
			soldier.wallTime = if hitWall and not engaged and speed > 10 then soldier.wallTime + dt else math.max(0, soldier.wallTime - dt)
			if soldier.wallTime > WALL_STUCK and soldier.route.mode ~= "detour" and takeDetourSearch(now) then
				soldier.wallTime = 0
				local detour = Navigation.findDetour(ground.obstacles, ground.bounds, soldier.x, soldier.z, tx, tz, SOLDIER_DETOUR_VISITS)
					or Navigation.findDetour(ground.obstacles, ground.bounds, soldier.x, soldier.z, center.x, center.z, SOLDIER_DETOUR_VISITS)
				if detour and #detour > 0 then
					soldier.route = { mode = "detour", index = 1, points = detour }
					soldier.nextThinkAt = now + 1 -- commit to it for a moment
				end
			end

			-- 7. Stuck while travelling (jammed in a gap, or a detour that didn't work
			-- out)? Search for a fresh detour from here. Only a wall in the way calls for
			-- one: when the straight line is clear, it's other soldiers in the way.
			if now >= soldier.nextStuckCheckAt then
				local travelling = soldier.route.mode ~= "slot" and not engaged
				local moved = dist(soldier.x, soldier.z, soldier.lastCheckX, soldier.lastCheckZ)
				if travelling and moved < STUCK_DISTANCE and dist(soldier.x, soldier.z, center.x, center.z) > CENTER_STANDOFF + 26
					and not Navigation.hasClearPath(ground.obstacles, soldier.x, soldier.z, center.x, center.z) and takeDetourSearch(now)
				then
					local detour = Navigation.findDetour(ground.obstacles, ground.bounds, soldier.x, soldier.z, center.x, center.z, SOLDIER_DETOUR_VISITS)
					if detour and #detour > 0 then
						soldier.route = { mode = "detour", index = 1, points = detour }
						soldier.nextThinkAt = now + 1.5 -- commit to it for a moment
					end
				end
				soldier.lastCheckX, soldier.lastCheckZ = soldier.x, soldier.z
				soldier.nextStuckCheckAt = now + STUCK_CHECK * (0.75 + ((soldier.id * 53) % 50) / 100)
			end

			-- 8. Rare emergency: badly separated for a long time? Put it back near the centre.
			if dist(soldier.x, soldier.z, center.x, center.z) < RECOVER_DISTANCE then
				soldier.lostSince = 0
			elseif soldier.lostSince == 0 then
				soldier.lostSince = now
			elseif now - soldier.lostSince >= RECOVER_AFTER then
				local fx, fz = Navigation.findFreeSpotNear(ground.obstacles, ground.bounds, center.x, center.z, 48)
				if fx and fz and Navigation.hasClearPath(ground.obstacles, fx, fz, center.x, center.z) then
					soldier.x, soldier.z, soldier.vx, soldier.vz = fx, fz, 0, 0
					soldier.route = { mode = "slot", index = 1, points = nil }
					soldier.lostSince = 0
				end
			end
		end
	end
end

return Army
