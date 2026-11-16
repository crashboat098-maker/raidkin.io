--!strict
--[[
	A player's army: one or more GROUPS (clusters) of soldiers that move together.
	Ported from the web's PlayerArmy.ts (open ground; the obstacle routing comes
	with the real map).

	The player steers an invisible "lead" point. Pressing SPACE splits every
	group with 2+ soldiers in half: the front half shoots out toward where the
	player points. Groups pack together like agar.io cells, each heading for
	where the player steers. The army's speed comes from its LARGEST group, so
	splitting makes it faster. Every group remembers the group it split from
	(its parent); after a while (small groups sooner, big ones later) it heads
	back and merges into it, and parents wait for children on their way back, so
	merges cascade up into one army again. The first group (the root) never
	leaves. Splitting only moves soldiers between groups; it never adds or
	removes any.
]]

local Config = require(script.Parent.Config)
local Movement = require(script.Parent.Movement)
local Army = require(script.Parent.Army)
local Obstacles = require(script.Parent.Obstacles)
local Navigation = require(script.Parent.Navigation)

local PlayerArmy = {}

local settings = Config.army
local split = settings.split

-- A group with a smaller one heading back to merge into it slows to this share of its speed.
local MERGE_WAIT_SPEED = 0.5

-- The solid things on the map (an open field until the server sets the real map).
local world: Obstacles.Obstacles = Obstacles.none()

-- Use the map's obstacles from now on (the server calls this once at start-up).
function PlayerArmy.useObstacles(obstacles: Obstacles.Obstacles)
	world = obstacles
end

local BODY_HALF_WIDTH, BODY_DEPTH = Movement.BODY_HALF_WIDTH, Movement.BODY_DEPTH

-- Can a group centre stand here (inside the play area, not in a wall)?
local function standable(x: number, z: number, bounds: Movement.Bounds): boolean
	return x >= bounds.minX and x <= bounds.maxX and z >= bounds.minZ and z <= bounds.maxZ
		and not world.blockedAt(x, z, BODY_HALF_WIDTH, BODY_DEPTH)
end

-- Move a group centre by (dx, dz), or as much of it as stays clear of walls (sliding along them).
local function nudge(p: Movement.Mover, dx: number, dz: number, bounds: Movement.Bounds)
	if standable(p.x + dx, p.z + dz, bounds) then
		p.x += dx
		p.z += dz
	elseif standable(p.x + dx, p.z, bounds) then
		p.x += dx
	elseif standable(p.x, p.z + dz, bounds) then
		p.z += dz
	end
end

-- The furthest point up to `length` from (x, z) along (dx, dz) that can be reached in a straight line.
local function clearAhead(x: number, z: number, dx: number, dz: number, length: number): (number, number)
	local m = Config.world.margin
	local bounds = { minX = m, minZ = m, maxX = Config.world.size - m, maxZ = Config.world.size - m }
	local bestX, bestZ = x, z
	for step = 12, length, 12 do
		local px, pz = x + dx * step, z + dz * step
		if not standable(px, pz, bounds) then
			break
		end
		bestX, bestZ = px, pz
	end
	return bestX, bestZ
end

export type ArmyCluster = {
	-- The group itself: centre, soldiers and heading (see Army).
	cluster: Army.Army,
	-- Id of the group this one split from (0 for the root, which never regroups).
	parentId: number,
	-- When this group was last split (its regroup clock counts from here).
	splitAt: number,
	-- Until this time it's shooting out after a split (0 = not launching), and where to.
	launchUntil: number,
	launchX: number,
	launchZ: number,
	-- How its centre finds its way to its place in the army (re-planned a few times a second).
	route: FollowRoute,
	nextPlanAt: number,
	-- Its own aim along the army's route (re-picked a few times a second).
	aim: Vector2?,
	nextAimAt: number,
	-- Stuck detection: where it was at the last check, and when to check next.
	lastCheckX: number,
	lastCheckZ: number,
	nextStuckCheckAt: number,
}

--[[
	How a group's centre gets to its place: straight there; along the lead's
	breadcrumbs (`index` counted from when the plan was made, `shifts` = how many
	crumbs had dropped off the trail then); or a detour around something.
]]
export type FollowRoute = {
	mode: "direct" | "trail" | "detour",
	index: number,
	shifts: number,
	points: { Vector2 }?,
}

export type PlayerArmy = {
	id: number,
	colorIndex: number,
	-- The invisible point the player steers. Never has soldiers.
	lead: Movement.Mover,
	-- The lead's top speed this update (the largest group's speed, slowed if the army lags):
	-- players' games use it to move their own army on screen without waiting for the server.
	leadSpeed: number,
	headingX: number,
	headingZ: number,
	-- The lead's route around obstacles toward where the player steers (its goal: nil when standing still).
	nav: Navigation.Navigator,
	-- The lead's recent positions, oldest first, and how many have dropped off the front.
	trail: { Vector2 },
	trailShifts: number,
	clusters: { ArmyCluster },
	nextClusterId: number,
	-- Every group id ever made -> its parent id (0 = none), so returning groups can skip parents that are gone.
	parentOf: { [number]: number },
	lastSplitAt: number,
}

type Plan = {
	-- Groups keeping a place in the blob (the root, groups still split, parents waiting for children).
	holding: { ArmyCluster },
	-- Groups heading back, each to its parent.
	returning: { [ArmyCluster]: ArmyCluster },
}

local function wrap(cluster: Army.Army, parentId: number, splitAt: number): ArmyCluster
	return {
		cluster = cluster,
		parentId = parentId,
		splitAt = splitAt,
		launchUntil = 0,
		launchX = 0,
		launchZ = 0,
		route = { mode = "direct", index = 1, shifts = 0, points = nil },
		nextPlanAt = 0,
		aim = nil,
		nextAimAt = 0,
		lastCheckX = cluster.center.x,
		lastCheckZ = cluster.center.z,
		nextStuckCheckAt = 0,
	}
end

function PlayerArmy.new(id: number, colorIndex: number, x: number, z: number): PlayerArmy
	return {
		id = id,
		colorIndex = colorIndex,
		lead = Movement.create(x, z),
		leadSpeed = Config.movement.maxSpeed,
		headingX = 0,
		headingZ = 1,
		nav = Navigation.newNavigator(),
		trail = {},
		trailShifts = 0,
		clusters = { wrap(Army.new(1, colorIndex, x, z), 0, -math.huge) },
		nextClusterId = 2,
		parentOf = { [1] = 0 },
		lastSplitAt = -math.huge,
	}
end

-- ---------------------------------------------------------------------------
-- Questions about an army
-- ---------------------------------------------------------------------------

function PlayerArmy.allSoldiers(army: PlayerArmy): { Army.Soldier }
	if #army.clusters == 1 then
		return army.clusters[1].cluster.soldiers
	end
	local all = {}
	for _, ac in army.clusters do
		table.move(ac.cluster.soldiers, 1, #ac.cluster.soldiers, #all + 1, all)
	end
	return all
end

function PlayerArmy.totalSoldiers(army: PlayerArmy): number
	local n = 0
	for _, ac in army.clusters do
		n += #ac.cluster.soldiers
	end
	return n
end

local function largestClusterSize(army: PlayerArmy): number
	local best = 0
	for _, ac in army.clusters do
		best = math.max(best, #ac.cluster.soldiers)
	end
	return best
end

-- The army's top speed: set by its LARGEST group, so splitting makes it faster.
function PlayerArmy.armySpeed(army: PlayerArmy): number
	return Config.movement.maxSpeed * Army.speedMultiplier(largestClusterSize(army), settings.speedCurve, settings.minSpeedMultiplier)
end

-- How long a group of `soldiers` stays split before heading back: small ones sooner, big ones later.
local function regroupDelay(soldiers: number): number
	local r = split.regroup
	return math.min(r.max, r.min + soldiers * r.perSoldier)
end

-- When this group heads back to its parent (never for the root).
local function regroupTime(ac: ArmyCluster): number
	if ac.parentId == 0 then
		return math.huge
	end
	return ac.splitAt + regroupDelay(#ac.cluster.soldiers)
end

-- Seconds until the next split group starts heading back (nil if the army is whole or already regrouping).
function PlayerArmy.secondsUntilRegroup(army: PlayerArmy, now: number): number?
	local soonest = math.huge
	for _, ac in army.clusters do
		local t = regroupTime(ac)
		if t > now and t < soonest then
			soonest = t
		end
	end
	return if soonest < math.huge then soonest - now else nil
end

-- The group closest to a point (where new recruits join).
function PlayerArmy.nearestCluster(army: PlayerArmy, x: number, z: number): Army.Army
	local best = army.clusters[1].cluster
	local bestD = math.huge
	for _, ac in army.clusters do
		local c = ac.cluster.center
		local d = (c.x - x) ^ 2 + (c.z - z) ^ 2
		if d < bestD then
			bestD = d
			best = ac.cluster
		end
	end
	return best
end

-- ---------------------------------------------------------------------------
-- Families (who regroups with whom)
-- ---------------------------------------------------------------------------

-- The group this one returns to: its parent, or the nearest ancestor still around.
local function findParent(army: PlayerArmy, ac: ArmyCluster): ArmyCluster?
	local id = ac.parentId
	local seen: { [number]: boolean } = {}
	while id ~= 0 and not seen[id] do
		seen[id] = true
		for _, c in army.clusters do
			if c.cluster.id == id and c ~= ac then
				return c
			end
		end
		id = army.parentOf[id] or 0
	end
	return nil
end

-- Keep exactly one root, and give groups whose whole ancestry is gone the root as parent.
local function repairFamily(army: PlayerArmy)
	local root: ArmyCluster? = nil
	for _, ac in army.clusters do
		if ac.parentId == 0 then
			root = ac
			break
		end
	end
	if not root then
		local biggest = army.clusters[1]
		for _, ac in army.clusters do
			if #ac.cluster.soldiers > #biggest.cluster.soldiers then
				biggest = ac
			end
		end
		biggest.parentId = 0
		army.parentOf[biggest.cluster.id] = 0
		root = biggest
	end
	assert(root)
	for _, ac in army.clusters do
		if ac ~= root and (ac.parentId == 0 or findParent(army, ac) == nil) then
			ac.parentId = root.cluster.id
			army.parentOf[ac.cluster.id] = root.cluster.id
		end
	end
end

--[[
	Who heads back this update. A group heads back once its time is up, unless
	children of its own are already due back: then it waits for them (up to
	maxWaitForReturn), so the smallest groups merge first.
]]
local function planRegroup(army: PlayerArmy, now: number): Plan
	local parents: { [ArmyCluster]: ArmyCluster | false } = {}
	for _, ac in army.clusters do
		parents[ac] = findParent(army, ac) or false
	end
	local function due(ac: ArmyCluster): boolean
		return parents[ac] ~= false and regroupTime(ac) <= now
	end

	local plan: Plan = { holding = {}, returning = {} }
	for _, ac in army.clusters do
		local parent = parents[ac]
		local waitingForChildren = false
		if now < regroupTime(ac) + split.regroup.maxWaitForReturn then
			for _, c in army.clusters do
				if c ~= ac and parents[c] == ac and due(c) then
					waitingForChildren = true
					break
				end
			end
		end
		if parent and due(ac) and not waitingForChildren then
			plan.returning[ac] = parent
		else
			table.insert(plan.holding, ac)
		end
	end
	return plan
end

-- ---------------------------------------------------------------------------
-- Splitting
-- ---------------------------------------------------------------------------

function PlayerArmy.canSplit(army: PlayerArmy, now: number): boolean
	if now - army.lastSplitAt < split.cooldown or #army.clusters >= split.maxClusters then
		return false
	end
	for _, ac in army.clusters do
		if #ac.cluster.soldiers >= split.minSoldiers then
			return true
		end
	end
	return false
end

--[[
	SPACE: split every group that has enough soldiers into two halves. The front
	half (toward `aimX, aimZ`, where the player points) breaks off and shoots
	out; the back half stays. Largest groups split first if the group limit
	would be reached. Returns how many groups were split.
]]
function PlayerArmy.split(army: PlayerArmy, now: number, aimX: number, aimZ: number): number
	if not PlayerArmy.canSplit(army, now) then
		return 0
	end

	local aimLength = math.sqrt(aimX * aimX + aimZ * aimZ)
	local fx, fz
	if aimLength > 0.001 then
		fx, fz = aimX / aimLength, aimZ / aimLength
	else
		fx, fz = army.headingX, army.headingZ
	end

	local candidates = {}
	for _, ac in army.clusters do
		if #ac.cluster.soldiers >= split.minSoldiers then
			table.insert(candidates, ac)
		end
	end
	table.sort(candidates, function(a, b)
		return #a.cluster.soldiers > #b.cluster.soldiers
	end)

	local made = 0
	for _, original in candidates do
		if #army.clusters >= split.maxClusters then
			break
		end
		local cluster = original.cluster
		local c = cluster.center

		-- The back half stays (the odd soldier out stays too); the front half breaks off toward the aim.
		local sorted = table.clone(cluster.soldiers)
		table.sort(sorted, function(a, b)
			return (a.x - c.x) * fx + (a.z - c.z) * fz < (b.x - c.x) * fx + (b.z - c.z) * fz
		end)
		local half = math.ceil(#sorted / 2)
		local back = table.move(sorted, 1, half, 1, {})
		local front = table.move(sorted, half + 1, #sorted, 1, {})

		local frontX, frontZ = Army.centroid(front)
		local child = Army.new(army.nextClusterId, army.colorIndex, frontX, frontZ)
		army.nextClusterId += 1
		child.soldiers = front
		child.headingX, child.headingZ = cluster.headingX, cluster.headingZ
		child.center.vx, child.center.vz = c.vx, c.vz

		local backX, backZ = Army.centroid(back)
		cluster.soldiers = back
		c.x, c.z = backX, backZ

		Army.reassignSlots(cluster, settings.formationSpacing)
		Army.reassignSlots(child, settings.formationSpacing)

		-- The new half is the original's child: it returns to it later. It shoots out
		-- ahead toward the aim, then falls back into the blob.
		original.splitAt = now
		army.parentOf[child.id] = cluster.id
		local wrapped = wrap(child, cluster.id, now)
		wrapped.launchUntil = now + split.launchTime
		local shot = Army.clusterRadius(#back, settings.formationSpacing) + Army.clusterRadius(#front, settings.formationSpacing) + split.launchDistance
		wrapped.launchX, wrapped.launchZ = clearAhead(backX, backZ, fx, fz, shot)
		table.insert(army.clusters, wrapped)
		made += 1
	end

	army.lastSplitAt = now
	return made
end

-- ---------------------------------------------------------------------------
-- Moving
-- ---------------------------------------------------------------------------

-- A group's own cruising speed: smaller groups are a little quicker than the army.
local function clusterBaseSpeed(ac: ArmyCluster, armySpeed: number): number
	local own = Config.movement.maxSpeed * Army.speedMultiplier(#ac.cluster.soldiers, settings.speedCurve, settings.minSpeedMultiplier)
	return armySpeed + math.max(0, own - armySpeed) * split.smallClusterBonus
end

-- Radius of the blob the groups pack into (their areas added up, with a little slack).
local function blobRadius(army: PlayerArmy): number
	local area = 0
	for _, ac in army.clusters do
		local r = Army.clusterRadius(#ac.cluster.soldiers, settings.formationSpacing) + split.clusterGap
		area += r * r
	end
	return math.sqrt(area) * 1.2
end

--[[
	Has this group fallen behind? It's beyond the blob's edge and on the far side
	of the steering point from where the army is heading. Groups ahead of the
	steering point are never "behind": nothing pulls them back.
]]
local function isBehind(ac: ArmyCluster, army: PlayerArmy, blob: number): boolean
	local c, lead = ac.cluster.center, army.lead
	local dx, dz = c.x - lead.x, c.z - lead.z
	if math.sqrt(dx * dx + dz * dz) <= blob then
		return false
	end
	local goal = army.nav.goal
	if not goal then
		return true
	end
	return dx * (goal.X - lead.x) + dz * (goal.Y - lead.z) < 0
end

-- How often each group re-picks its aim along the army's route (seconds, staggered).
local AIM_REPICK = 0.25

--[[
	Where a holding group heads: straight for the player's goal if it can walk
	there, else the furthest point of the army's route it can walk straight to
	(so a group that lunged ahead never turns back for a waypoint it has already
	passed). The steering point when standing still, or when nothing on the route
	is in a straight line (the group then follows the army's footsteps).
]]
local function aimFor(ac: ArmyCluster, army: PlayerArmy, now: number): Vector2
	local lead = Vector2.new(army.lead.x, army.lead.z)
	local nav = army.nav
	local goal = nav.goal
	if not goal then
		ac.aim = nil
		return lead
	end
	local current = ac.aim
	if current and now < ac.nextAimAt then
		return current
	end
	local c = ac.cluster.center
	local aim = lead
	if #nav.path == 0 then
		aim = goal -- the army's own way there is straight
	elseif not nav.partial and Navigation.hasDryPath(world, c.x, c.z, goal.X, goal.Y) then
		aim = goal
	else
		for k = #nav.path, nav.index, -1 do
			local p = nav.path[k]
			if Navigation.hasClearPath(world, c.x, c.z, p.X, p.Y) then
				aim = p
				break
			end
		end
	end
	ac.aim = aim
	ac.nextAimAt = now + AIM_REPICK * (0.8 + (ac.cluster.id % 5) / 10)
	return aim
end

--[[
	Where each group heads, like agar.io cells: holding groups head for where
	the player steers, along the army's route (or the lead when standing still);
	a freshly split group first shoots out to its launch point; when regrouping,
	the smaller group runs back to the bigger one, which holds its place.
]]
local function clusterTargets(army: PlayerArmy, plan: Plan, now: number): { [ArmyCluster]: Vector2 }
	local targets: { [ArmyCluster]: Vector2 } = {}
	local lead = Vector2.new(army.lead.x, army.lead.z)
	local goal = Navigation.goalOf(army.nav) or lead
	for _, ac in plan.holding do
		if ac.launchUntil > 0 then
			targets[ac] = Vector2.new(ac.launchX, ac.launchZ)
		else
			targets[ac] = aimFor(ac, army, now)
		end
	end
	for ac, parent in plan.returning do
		if #ac.cluster.soldiers <= #parent.cluster.soldiers then
			targets[ac] = Vector2.new(parent.cluster.center.x, parent.cluster.center.z)
		else
			targets[ac] = goal
			targets[parent] = Vector2.new(ac.cluster.center.x, ac.cluster.center.z)
		end
	end
	return targets
end

--[[
	Slow the lead when the bulk of the army has fallen well behind. Uses the
	soldier-weighted middle lag, not the worst group, so one straggler never
	stalls everyone.
]]
local function leashFactor(army: PlayerArmy, plan: Plan, targets: { [ArmyCluster]: Vector2 }): number
	local lags = {}
	local totalWeight = 0
	local blob = blobRadius(army)
	for _, ac in army.clusters do
		local c = ac.cluster.center
		local lag = 0
		if ac.launchUntil > 0 then
			lag = 0
		elseif not plan.returning[ac] then
			lag = if isBehind(ac, army, blob) then math.sqrt((c.x - army.lead.x) ^ 2 + (c.z - army.lead.z) ^ 2) - blob else 0
		else
			local t = targets[ac]
			if t then
				lag = math.sqrt((c.x - t.X) ^ 2 + (c.z - t.Y) ^ 2)
			end
		end
		if #ac.cluster.soldiers > 0 then
			local mx, mz = Army.centroid(ac.cluster.soldiers)
			lag = math.max(lag, math.sqrt((c.x - mx) ^ 2 + (c.z - mz) ^ 2))
		end
		local weight = math.max(1, #ac.cluster.soldiers)
		table.insert(lags, { lag = lag, weight = weight })
		totalWeight += weight
	end
	table.sort(lags, function(a, b)
		return a.lag < b.lag
	end)
	local lag, seen = 0, 0
	for _, entry in lags do
		seen += entry.weight
		lag = entry.lag
		if seen >= totalWeight / 2 then
			break
		end
	end
	local leash = settings.leash
	if lag <= leash.startDistance then
		return 1
	end
	return math.max(0.15, 1 - (lag - leash.startDistance) / (leash.fullStopDistance - leash.startDistance))
end

-- Move a group's centre toward its target, easing off as it arrives.
-- How often a group re-plans its way, how often it checks for being stuck, and
-- how little movement counts as stuck. Only breadcrumbs this close are considered.
local REPLAN = 0.3
local STUCK_CHECK = 0.9
local STUCK_DISTANCE = 4
local CRUMB_SEARCH_RADIUS = 220

local function dist(ax: number, az: number, bx: number, bz: number): number
	return math.sqrt((ax - bx) ^ 2 + (az - bz) ^ 2)
end

--[[
	The cheapest way for a group's centre to reach its target: straight there if
	the way is dry and clear; else the newest of the lead's breadcrumbs it can
	walk straight to (the army just walked them, so they're known to be clear);
	else straight (sliding along) until a stuck check finds a detour.
]]
local function planFollow(army: PlayerArmy, x: number, z: number, target: Vector2, current: FollowRoute): FollowRoute
	if Navigation.hasDryPath(world, x, z, target.X, target.Y) then
		return { mode = "direct", index = 1, shifts = 0, points = nil }
	end
	-- Keep following a detour that's still in progress.
	if current.mode == "detour" and current.points and current.index <= #current.points then
		return current
	end
	-- The newest breadcrumb we can walk straight to, dry ones first (the lead's
	-- footsteps go round walls and over bridges). Never one further from the target
	-- than we already are (e.g. behind a group that lunged ahead).
	local trail = army.trail
	local toGo = dist(x, z, target.X, target.Y)
	local wetCrumb = -1
	for i = #trail, 1, -1 do
		local crumb = trail[i]
		if dist(crumb.X, crumb.Y, x, z) <= CRUMB_SEARCH_RADIUS and dist(crumb.X, crumb.Y, target.X, target.Y) < toGo
			and Navigation.hasClearPath(world, x, z, crumb.X, crumb.Y)
		then
			if not Navigation.wadesBetween(world, x, z, crumb.X, crumb.Y) then
				return { mode = "trail", index = i, shifts = army.trailShifts, points = nil }
			end
			if wetCrumb < 0 then
				wetCrumb = i
			end
		end
	end
	if Navigation.hasClearPath(world, x, z, target.X, target.Y) then
		return { mode = "direct", index = 1, shifts = 0, points = nil }
	end
	if wetCrumb > 0 then
		return { mode = "trail", index = wetCrumb, shifts = army.trailShifts, points = nil }
	end
	if current.mode == "trail" then
		return current
	end
	return { mode = "direct", index = 1, shifts = 0, points = nil }
end

local function steerCluster(army: PlayerArmy, ac: ArmyCluster, target: Vector2, armySpeed: number, pace: number, dt: number, now: number, bounds: Movement.Bounds)
	local c = ac.cluster.center

	-- Which way? Re-planned a few times a second, staggered.
	if now >= ac.nextPlanAt then
		ac.route = planFollow(army, c.x, c.z, target, ac.route)
		ac.nextPlanAt = now + REPLAN * (0.8 + (ac.cluster.id % 5) / 10)
	end
	local goalX, goalZ = target.X, target.Y
	local arriving = true
	local route = ac.route
	if route.mode == "trail" then
		-- The trail may have lost crumbs off its front since the plan was made.
		local index = route.index - (army.trailShifts - route.shifts)
		local crumb = army.trail[math.max(1, index)]
		if not crumb or index > #army.trail then
			ac.route = { mode = "direct", index = 1, shifts = 0, points = nil }
		else
			goalX, goalZ, arriving = crumb.X, crumb.Y, false
			if dist(c.x, c.z, crumb.X, crumb.Y) < 8 then
				route.index += 1
			end
		end
	elseif route.mode == "detour" then
		local point = route.points and route.points[route.index]
		if not point then
			ac.route = { mode = "direct", index = 1, shifts = 0, points = nil }
		else
			goalX, goalZ, arriving = point.X, point.Y, false
			if dist(c.x, c.z, point.X, point.Y) < 6 then
				route.index += 1
			end
		end
	end

	-- Head for the goal, easing off near the target so groups settle smoothly.
	local dx, dz = goalX - c.x, goalZ - c.z
	local d = math.sqrt(dx * dx + dz * dz)
	local throttle = if arriving then math.min(1, d / 16) else 1
	if d > 0.5 then
		dx /= d
		dz /= d
	else
		dx, dz, throttle = 0, 0, 0
	end

	-- Freshly split: shoot out to the launch point, then fall back into the blob.
	if ac.launchUntil > 0 and (now >= ac.launchUntil or (arriving and d < 10)) then
		ac.launchUntil = 0
	end
	local launching = ac.launchUntil > 0
	-- Size alone sets a group's speed (smaller is quicker), except for the short lunge after a split.
	local speed = clusterBaseSpeed(ac, armySpeed) * (if launching then split.launchBoost * split.followSpeedMultiplier else pace)
	if launching then
		throttle = 1
	else
		-- Never outrun its own soldiers.
		speed = math.min(speed, settings.warriorSpeed * settings.catchUpMultiplier)
	end
	Movement.update(c, dx * throttle, dz * throttle, dt, {
		maxSpeed = speed,
		acceleration = Config.movement.acceleration,
		deceleration = Config.movement.deceleration,
	}, bounds, world)

	-- Stuck? Find a way round: a short local search first, then a wider route search
	-- (e.g. along a river to its bridge).
	if now >= ac.nextStuckCheckAt then
		if dist(c.x, c.z, ac.lastCheckX, ac.lastCheckZ) < STUCK_DISTANCE and dist(c.x, c.z, target.X, target.Y) > 24 then
			local detour = Navigation.findDetour(world, bounds, c.x, c.z, target.X, target.Y)
			if not detour then
				detour = Navigation.findPath(world, bounds, c.x, c.z, target.X, target.Y)
			end
			if detour and #detour > 0 then
				ac.route = { mode = "detour", index = 1, shifts = 0, points = detour }
				ac.nextPlanAt = now + 1.5
			end
		end
		ac.lastCheckX, ac.lastCheckZ = c.x, c.z
		ac.nextStuckCheckAt = now + STUCK_CHECK
	end
end

--[[
	Push overlapping groups apart (a few passes), so split groups touch but never
	overlap. Bigger groups give way less. A group heading back to merge, and the
	one it merges into, pass through the others.
]]
local function packClusters(army: PlayerArmy, plan: Plan, bounds: Movement.Bounds)
	local solid = {}
	for _, ac in army.clusters do
		if not plan.returning[ac] and #ac.cluster.soldiers > 0 then
			table.insert(solid, ac)
		end
	end
	if #solid < 2 then
		return
	end
	local radius, weight = {}, {}
	for i, ac in solid do
		radius[i] = Army.clusterRadius(#ac.cluster.soldiers, settings.formationSpacing)
		weight[i] = #ac.cluster.soldiers
	end
	local gap = split.clusterGap
	for _ = 1, 3 do
		for i = 1, #solid do
			for j = i + 1, #solid do
				local a, b = solid[i].cluster.center, solid[j].cluster.center
				local dx, dz = b.x - a.x, b.z - a.z
				local wanted = radius[i] + radius[j] + gap
				if math.abs(dx) < wanted and math.abs(dz) < wanted then
					local d = math.sqrt(dx * dx + dz * dz)
					if d < wanted then
						if d < 0.01 then
							-- Exactly on top of each other: split them sideways, a stable way.
							dx = if solid[i].cluster.id % 2 == 1 then 1 else -1
							dz = 0.3
							d = math.sqrt(dx * dx + dz * dz)
						end
						local overlap = (wanted - d) * 0.5 -- half per pass keeps it smooth
						local ux, uz = dx / d, dz / d
						local share = weight[i] / (weight[i] + weight[j]) -- the heavier one moves less
						nudge(a, -ux * overlap * (1 - share), -uz * overlap * (1 - share), bounds)
						nudge(b, ux * overlap * share, uz * overlap * share, bounds)
					end
				end
			end
		end
	end
end

--[[
	A returning group merges into its parent once they overlap. The parent keeps
	its identity (and its own children) and grows. Returns how many merges happened.
]]
local function mergeReturning(army: PlayerArmy, plan: Plan): number
	local returning = {}
	for child, parent in plan.returning do
		table.insert(returning, { child = child, parent = parent })
	end
	-- Smallest first, so a parent that takes in a child this update still counts as present.
	table.sort(returning, function(a, b)
		return #a.child.cluster.soldiers < #b.child.cluster.soldiers
	end)

	local merges = 0
	for _, pair in returning do
		local child, parent = pair.child, pair.parent
		if table.find(army.clusters, child) and table.find(army.clusters, parent) then
			local cc, pc = child.cluster.center, parent.cluster.center
			local rc = Army.clusterRadius(#child.cluster.soldiers, settings.formationSpacing)
			local rp = Army.clusterRadius(#parent.cluster.soldiers, settings.formationSpacing)
			if math.sqrt((cc.x - pc.x) ^ 2 + (cc.z - pc.z) ^ 2) <= math.max(rc, rp) then
				merges += 1
				-- The merged group forms up where the bigger one stands.
				if #child.cluster.soldiers > #parent.cluster.soldiers then
					pc.x, pc.z, pc.vx, pc.vz = cc.x, cc.z, cc.vx, cc.vz
				end
				table.move(child.cluster.soldiers, 1, #child.cluster.soldiers, #parent.cluster.soldiers + 1, parent.cluster.soldiers)
				child.cluster.soldiers = {}
				table.remove(army.clusters, table.find(army.clusters, child) :: number)
				Army.reassignSlots(parent.cluster, settings.formationSpacing)
			end
		end
	end
	-- Back together as one: the steering point moves to the army (not the army to it).
	if merges > 0 and #army.clusters == 1 then
		local c = army.clusters[1].cluster.center
		army.lead.x, army.lead.z = c.x, c.z
		army.nav.nextPlanAt = 0 -- its route was planned from where it stood
	end
	return merges
end

--[[
	One update for the whole army: move the lead with the player's steering
	(`steerX, steerZ`), have every group follow, push the groups apart, move the
	soldiers, and merge groups whose time has come. Returns how many merged.
]]
function PlayerArmy.update(army: PlayerArmy, steerX: number, steerZ: number, dt: number, now: number, bounds: Movement.Bounds): number
	-- Drop groups that have lost all their soldiers (combat, later), but keep at least one.
	if #army.clusters > 1 then
		for i = #army.clusters, 1, -1 do
			if #army.clusters[i].cluster.soldiers == 0 and #army.clusters > 1 then
				table.remove(army.clusters, i)
			end
		end
	end
	repairFamily(army)

	local plan = planRegroup(army, now)
	local armySpeed = PlayerArmy.armySpeed(army)
	local targets = clusterTargets(army, plan, now)

	-- The lead: player-steered, at the largest group's speed, slowed if the army lags.
	-- It walks a route around obstacles toward where the player points.
	army.leadSpeed = armySpeed * leashFactor(army, plan, targets)
	local sx, sz = Navigation.steerAround(army.nav, world, bounds, army.lead.x, army.lead.z, steerX, steerZ, now)
	Movement.update(army.lead, sx, sz, dt, {
		maxSpeed = army.leadSpeed,
		acceleration = Config.movement.acceleration,
		deceleration = Config.movement.deceleration,
	}, bounds, world)
	local currentSpeed = math.sqrt(army.lead.vx ^ 2 + army.lead.vz ^ 2)
	if currentSpeed >= 10 then
		army.headingX, army.headingZ = army.lead.vx / currentSpeed, army.lead.vz / currentSpeed
	end
	-- The lead's breadcrumbs: groups that lose sight of their place follow them.
	local last = army.trail[#army.trail]
	if not last or dist(last.X, last.Y, army.lead.x, army.lead.z) >= 10 then
		table.insert(army.trail, Vector2.new(army.lead.x, army.lead.z))
		if #army.trail > 200 then
			table.remove(army.trail, 1)
			army.trailShifts += 1
		end
	end

	-- A group that a smaller one is coming back to eases off so it can be caught.
	local waitingForChild: { [ArmyCluster]: boolean } = {}
	for child, parent in plan.returning do
		waitingForChild[if #child.cluster.soldiers <= #parent.cluster.soldiers then parent else child] = true
	end
	for _, ac in army.clusters do
		local target = targets[ac] or Vector2.new(army.lead.x, army.lead.z)
		steerCluster(army, ac, target, armySpeed, if waitingForChild[ac] then MERGE_WAIT_SPEED else 1, dt, now, bounds)
	end
	packClusters(army, plan, bounds)
	local ground: Army.Ground = { obstacles = world, bounds = bounds, now = now }
	for _, ac in army.clusters do
		Army.updateSoldiers(ac.cluster, dt, settings, ground)
	end

	return mergeReturning(army, plan)
end

return PlayerArmy
