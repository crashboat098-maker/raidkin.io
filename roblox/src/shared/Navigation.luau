--!strict
--[[
	Finding the way around obstacles, ported from the web's Navigation.ts and the
	route helpers in Army.ts.

	The army's steering point used to walk in a straight line and slide along
	walls. Now it plans a route: when the way to where the player steers is
	blocked, an A* search on a coarse grid finds corner waypoints around the
	walls (and prefers bridges to wading). Groups and soldiers use the cheaper
	helpers here: "can I walk straight there?", and a small breadth-first detour
	search when they're stuck.

	All positions are in px; z is the web's y (south).
]]

local Obstacles = require(script.Parent.Obstacles)

local Navigation = {}

export type Bounds = { minX: number, minZ: number, maxX: number, maxZ: number }

-- A soldier's (and a steering point's) solid footprint.
local BODY = 3

local function dist(ax: number, az: number, bx: number, bz: number): number
	return math.sqrt((ax - bx) ^ 2 + (az - bz) ^ 2)
end

local function inside(bounds: Bounds, x: number, z: number): boolean
	return x >= bounds.minX and x <= bounds.maxX and z >= bounds.minZ and z <= bounds.maxZ
end

-- ---------------------------------------------------------------------------
-- Straight lines
-- ---------------------------------------------------------------------------

-- Can a soldier walk in a straight line from a to b without touching an obstacle?
function Navigation.hasClearPath(obs: Obstacles.Obstacles, ax: number, az: number, bx: number, bz: number): boolean
	local steps = math.ceil(dist(ax, az, bx, bz) / 4)
	for i = 1, steps do
		local t = i / steps
		if obs.blockedAt(ax + (bx - ax) * t, az + (bz - az) * t, BODY, BODY) then
			return false
		end
	end
	return true
end

--[[
	Would walking straight from dry a to dry b wade through water or lava on the
	way (e.g. across a river when a bridge is near)? False when either end is
	already wet: then there's no dry way to avoid it.
]]
function Navigation.wadesBetween(obs: Obstacles.Obstacles, ax: number, az: number, bx: number, bz: number): boolean
	if obs.travelCost(ax, az) > 1 or obs.travelCost(bx, bz) > 1 then
		return false
	end
	local steps = math.ceil(dist(ax, az, bx, bz) / 4)
	for i = 1, steps - 1 do
		local t = i / steps
		if obs.travelCost(ax + (bx - ax) * t, az + (bz - az) * t) > 1 then
			return true
		end
	end
	return false
end

-- A straight walk that's clear of obstacles and stays dry.
function Navigation.hasDryPath(obs: Obstacles.Obstacles, ax: number, az: number, bx: number, bz: number): boolean
	return not Navigation.wadesBetween(obs, ax, az, bx, bz) and Navigation.hasClearPath(obs, ax, az, bx, bz)
end

-- The closest spot to (x, z) where a soldier fits, searching outward in rings (nil if none within maxRadius).
function Navigation.findFreeSpotNear(obs: Obstacles.Obstacles, bounds: Bounds, x: number, z: number, maxRadius: number): (number?, number?)
	local function fits(px: number, pz: number): boolean
		return inside(bounds, px, pz) and not obs.blockedAt(px, pz, BODY, BODY)
	end
	if fits(x, z) then
		return x, z
	end
	for radius = 4, maxRadius, 4 do
		local steps = math.max(8, math.round(radius / 2))
		for i = 0, steps - 1 do
			local angle = i / steps * math.pi * 2
			local px, pz = x + math.cos(angle) * radius, z + math.sin(angle) * radius
			if fits(px, pz) then
				return px, pz
			end
		end
	end
	return nil, nil
end

-- ---------------------------------------------------------------------------
-- A* for the army's route
-- ---------------------------------------------------------------------------

-- Path search grid cell (px), how far around the start and goal it may look, and work limits.
local CELL = 12
local MARGIN = 320
local MAX_CELLS = 40_000
local MAX_EXPANSIONS = 7_000

-- A small binary min-heap of grid indexes, keyed by priority.
local function newHeap()
	local items: { number }, keys: { number } = {}, {}
	local heap = {}
	function heap.size(): number
		return #items
	end
	function heap.push(item: number, key: number)
		local i = #items + 1
		items[i], keys[i] = item, key
		while i > 1 do
			local parent = i // 2
			if keys[parent] <= key then
				break
			end
			items[i], keys[i] = items[parent], keys[parent]
			i = parent
		end
		items[i], keys[i] = item, key
	end
	function heap.pop(): number
		local top = items[1]
		local n = #items
		local lastItem, lastKey = items[n], keys[n]
		items[n], keys[n] = nil, nil
		n -= 1
		if n == 0 then
			return top
		end
		local i = 1
		while true do
			local child = i * 2
			if child > n then
				break
			end
			if child + 1 <= n and keys[child + 1] < keys[child] then
				child += 1
			end
			if keys[child] >= lastKey then
				break
			end
			items[i], keys[i] = items[child], keys[child]
			i = child
		end
		items[i], keys[i] = lastItem, lastKey
		return top
	end
	return heap
end

-- The highest travel cost met walking straight from a to b.
local function worstCostAlong(obs: Obstacles.Obstacles, ax: number, az: number, bx: number, bz: number): number
	local steps = math.max(1, math.ceil(dist(ax, az, bx, bz) / 4))
	local worst = 1
	for i = 0, steps do
		local t = i / steps
		worst = math.max(worst, obs.travelCost(ax + (bx - ax) * t, az + (bz - az) * t))
	end
	return worst
end

--[[
	A* on a coarse grid between two points, limited to a window around them.
	Returns corner waypoints (the first walkable straight from the start) and
	whether the goal itself was reached (false: the route ends at the closest
	point that can be), or nil if nothing better than standing still was found.
]]
function Navigation.findPath(obs: Obstacles.Obstacles, bounds: Bounds, fromX: number, fromZ: number, toX: number, toZ: number): ({ Vector2 }?, boolean)
	-- Aim at a free spot: a goal inside a tree would never be reached.
	local fx, fz = Navigation.findFreeSpotNear(obs, bounds, toX, toZ, 48)
	local goalX, goalZ = fx or toX, fz or toZ

	local minX = math.max(bounds.minX, math.min(fromX, goalX) - MARGIN)
	local minZ = math.max(bounds.minZ, math.min(fromZ, goalZ) - MARGIN)
	local maxX = math.min(bounds.maxX, math.max(fromX, goalX) + MARGIN)
	local maxZ = math.min(bounds.maxZ, math.max(fromZ, goalZ) + MARGIN)
	local cols = math.floor((maxX - minX) / CELL) + 1
	local rows = math.floor((maxZ - minZ) / CELL) + 1
	if cols <= 0 or rows <= 0 or cols * rows > MAX_CELLS then
		return nil, false
	end

	local function px(c: number): number
		return minX + c * CELL
	end
	local function pz(r: number): number
		return minZ + r * CELL
	end
	local function colOf(x: number): number
		return math.clamp(math.round((x - minX) / CELL), 0, cols - 1)
	end
	local function rowOf(z: number): number
		return math.clamp(math.round((z - minZ) / CELL), 0, rows - 1)
	end

	-- 0 = unknown, 1 = free, 2 = blocked (checked only where the search goes).
	local state = buffer.create(cols * rows)
	local function free(c: number, r: number): boolean
		local i = r * cols + c
		local s = buffer.readu8(state, i)
		if s == 0 then
			s = if obs.blockedAt(px(c), pz(r), BODY, BODY) then 2 else 1
			buffer.writeu8(state, i, s)
		end
		return s == 1
	end

	local sc, sr = colOf(fromX), rowOf(fromZ)
	local gc, gr = colOf(goalX), rowOf(goalZ)
	local start, goal = sr * cols + sc, gr * cols + gc
	local function heuristic(c: number, r: number): number
		local dx, dz = math.abs(c - gc), math.abs(r - gr)
		return math.max(dx, dz) + 0.414 * math.min(dx, dz)
	end

	local cost: { [number]: number } = { [start] = 0 }
	local came: { [number]: number } = { [start] = start }
	local closed: { [number]: boolean } = {}
	local heap = newHeap()
	heap.push(start, heuristic(sc, sr))

	local best, bestH = start, heuristic(sc, sr)
	local found = false
	local expansions = 0
	while heap.size() > 0 and expansions < MAX_EXPANSIONS do
		local index = heap.pop()
		if not closed[index] then
			closed[index] = true
			expansions += 1
			local c = index % cols
			local r = (index - c) // cols
			local h = heuristic(c, r)
			if h < bestH then
				bestH, best = h, index
			end
			if index == goal then
				found = true
				break
			end
			for dr = -1, 1 do
				for dc = -1, 1 do
					local nc, nr = c + dc, r + dr
					if (dc ~= 0 or dr ~= 0) and nc >= 0 and nr >= 0 and nc < cols and nr < rows then
						local n = nr * cols + nc
						-- No cutting corners past an obstacle.
						if not closed[n] and free(nc, nr) and (dc == 0 or dr == 0 or (free(c + dc, r) and free(c, r + dr))) then
							local step = (if dc ~= 0 and dr ~= 0 then 1.414 else 1) * obs.travelCost(px(nc), pz(nr))
							local nextCost = cost[index] + step
							if nextCost < (cost[n] or math.huge) then
								cost[n] = nextCost
								came[n] = index
								heap.push(n, nextCost + heuristic(nc, nr))
							end
						end
					end
				end
			end
		end
	end

	local finish = if found then goal else best
	if finish == start then
		return nil, false
	end

	-- Walk back from the end, then keep only the corners actually needed.
	local cells: { Vector2 } = {}
	local i = finish
	while i ~= start do
		table.insert(cells, 1, Vector2.new(px(i % cols), pz(i // cols)))
		i = came[i]
	end
	if found then
		cells[#cells] = Vector2.new(goalX, goalZ)
	end

	-- A shortcut may not cross worse ground than the cells it skips (no cutting
	-- across the river when the route goes over the bridge).
	local points: { Vector2 } = {}
	local ax, az = fromX, fromZ
	local spanCost = obs.travelCost(fromX, fromZ)
	for k = 1, #cells do
		local cell = cells[k]
		spanCost = math.max(spanCost, obs.travelCost(cell.X, cell.Y))
		local nextCell = cells[k + 1]
		local nextSpan = if nextCell then math.max(spanCost, obs.travelCost(nextCell.X, nextCell.Y)) else spanCost
		if not nextCell
			or not Navigation.hasClearPath(obs, ax, az, nextCell.X, nextCell.Y)
			or worstCostAlong(obs, ax, az, nextCell.X, nextCell.Y) > nextSpan
		then
			table.insert(points, cell)
			ax, az = cell.X, cell.Y
			spanCost = obs.travelCost(ax, az)
		end
	end
	return points, found
end

-- ---------------------------------------------------------------------------
-- Breadth-first detours for groups and soldiers
-- ---------------------------------------------------------------------------

local DETOUR_CELL = 8
local DETOUR_MARGIN = 120
local DETOUR_MAX_CELLS = 20_000

--[[
	Breadth-first search on a coarse grid between two points, limited to a window
	around them (and to `maxVisits` cells). Returns a short list of waypoints, or nil.
]]
function Navigation.findDetour(obs: Obstacles.Obstacles, bounds: Bounds, fromX: number, fromZ: number, toX: number, toZ: number, maxVisits: number?): { Vector2 }?
	local minX = math.max(bounds.minX, math.min(fromX, toX) - DETOUR_MARGIN)
	local minZ = math.max(bounds.minZ, math.min(fromZ, toZ) - DETOUR_MARGIN)
	local maxX = math.min(bounds.maxX, math.max(fromX, toX) + DETOUR_MARGIN)
	local maxZ = math.min(bounds.maxZ, math.max(fromZ, toZ) + DETOUR_MARGIN)
	local cols = math.floor((maxX - minX) / DETOUR_CELL) + 1
	local rows = math.floor((maxZ - minZ) / DETOUR_CELL) + 1
	if cols <= 0 or rows <= 0 or cols * rows > DETOUR_MAX_CELLS then
		return nil
	end
	local function cx(c: number): number
		return minX + c * DETOUR_CELL
	end
	local function cz(r: number): number
		return minZ + r * DETOUR_CELL
	end
	local state = buffer.create(cols * rows)
	local function free(c: number, r: number): boolean
		local i = r * cols + c
		local s = buffer.readu8(state, i)
		if s == 0 then
			s = if obs.blockedAt(cx(c), cz(r), BODY, BODY) then 2 else 1
			buffer.writeu8(state, i, s)
		end
		return s == 1
	end

	local sc = math.clamp(math.round((fromX - minX) / DETOUR_CELL), 0, cols - 1)
	local sr = math.clamp(math.round((fromZ - minZ) / DETOUR_CELL), 0, rows - 1)
	local gc = math.clamp(math.round((toX - minX) / DETOUR_CELL), 0, cols - 1)
	local gr = math.clamp(math.round((toZ - minZ) / DETOUR_CELL), 0, rows - 1)
	local startIndex = sr * cols + sc
	local came: { [number]: number } = { [startIndex] = startIndex }
	local queue = { startIndex }
	local head = 1
	local found = -1
	local limit = maxVisits or math.huge
	while head <= #queue and head <= limit do
		local index = queue[head]
		head += 1
		local c = index % cols
		local r = index // cols
		if math.abs(c - gc) <= 1 and math.abs(r - gr) <= 1 then
			found = index
			break
		end
		for _, step in { { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } } do
			local nc, nr = c + step[1], r + step[2]
			if nc >= 0 and nr >= 0 and nc < cols and nr < rows then
				local n = nr * cols + nc
				-- Both cells may be free while the step between them clips a small obstacle (a trunk).
				if came[n] == nil and free(nc, nr) and Navigation.hasClearPath(obs, cx(c), cz(r), cx(nc), cz(nr)) then
					came[n] = index
					table.insert(queue, n)
				end
			end
		end
	end
	if found < 0 then
		return nil
	end

	local cells: { Vector2 } = {}
	local i = found
	while i ~= startIndex do
		table.insert(cells, 1, Vector2.new(cx(i % cols), cz(i // cols)))
		i = came[i]
	end
	local waypoints: { Vector2 } = {}
	local ax, az = fromX, fromZ
	for k = 1, #cells do
		local nextCell = cells[k + 1]
		if not nextCell or not Navigation.hasClearPath(obs, ax, az, nextCell.X, nextCell.Y) then
			table.insert(waypoints, cells[k])
			ax, az = cells[k].X, cells[k].Y
		end
	end
	return waypoints
end

-- ---------------------------------------------------------------------------
-- Steering the army's point along a route
-- ---------------------------------------------------------------------------

-- How far ahead to aim when steering by direction only (keys, mouse, bots).
local LOOKAHEAD = 360
-- Re-plan this often, or straight away when the steering turns a lot (~20 degrees).
local REPLAN = 0.3
local REPLAN_TURN_DOT = 0.94
-- Close enough to a waypoint to move on to the next one.
local WAYPOINT_REACHED = 10

export type Navigator = {
	-- Waypoints toward the goal (empty = walk straight).
	path: { Vector2 },
	index: number,
	-- The route ends short of the goal (it can't be reached): stop at the end instead of pushing on.
	partial: boolean,
	nextPlanAt: number,
	lastDirX: number,
	lastDirZ: number,
	-- Where the player is steering to (a point ahead); nil when standing still.
	goal: Vector2?,
}

function Navigation.newNavigator(): Navigator
	return { path = {}, index = 1, partial = false, nextPlanAt = 0, lastDirX = 0, lastDirZ = 0, goal = nil }
end

--[[
	Where split groups should head right now: the next waypoint of the route,
	else the player's goal itself. Nil when the army is standing still (or its
	route ends short and it's waiting).
]]
function Navigation.goalOf(nav: Navigator): Vector2?
	if not nav.goal then
		return nil
	end
	local point = nav.path[nav.index]
	if point then
		return point
	end
	return if nav.partial then nil else nav.goal
end

local function plan(nav: Navigator, obs: Obstacles.Obstacles, bounds: Bounds, fromX: number, fromZ: number, goal: Vector2)
	nav.index = 1
	nav.partial = false
	if Navigation.hasDryPath(obs, fromX, fromZ, goal.X, goal.Y) then
		nav.path = {}
		return
	end
	local points, complete = Navigation.findPath(obs, bounds, fromX, fromZ, goal.X, goal.Y)
	-- No search possible (boxed in): fall back to sliding along walls.
	nav.path = points or {}
	nav.partial = points ~= nil and not complete
end

--[[
	Turn the player's steering (a direction, 0-1 long) into a direction that
	walks a route around obstacles. Same strength as the input; only the
	direction changes.
]]
function Navigation.steerAround(nav: Navigator, obs: Obstacles.Obstacles, bounds: Bounds, fromX: number, fromZ: number, inX: number, inZ: number, now: number): (number, number)
	local strength = math.min(1, math.sqrt(inX * inX + inZ * inZ))
	if strength < 0.01 then
		nav.path = {}
		nav.partial = false
		nav.goal = nil
		return 0, 0
	end
	local length = math.sqrt(inX * inX + inZ * inZ)
	local dx, dz = inX / length, inZ / length
	local goal = Vector2.new(
		math.clamp(fromX + dx * LOOKAHEAD, bounds.minX, bounds.maxX),
		math.clamp(fromZ + dz * LOOKAHEAD, bounds.minZ, bounds.maxZ)
	)
	nav.goal = goal

	local turned = dx * nav.lastDirX + dz * nav.lastDirZ < REPLAN_TURN_DOT
	if now >= nav.nextPlanAt or turned then
		plan(nav, obs, bounds, fromX, fromZ, goal)
		nav.lastDirX, nav.lastDirZ = dx, dz
		nav.nextPlanAt = now + REPLAN
	end
	if #nav.path == 0 then
		return dx * strength, dz * strength
	end

	-- Move on past waypoints we've reached, or can already see past.
	while nav.index <= #nav.path and dist(fromX, fromZ, nav.path[nav.index].X, nav.path[nav.index].Y) < WAYPOINT_REACHED do
		nav.index += 1
	end
	local following = nav.path[nav.index + 1]
	if following and Navigation.hasDryPath(obs, fromX, fromZ, following.X, following.Y) then
		nav.index += 1
	end
	local point = nav.path[nav.index]
	if not point then
		-- At the end of the route. Partial: as close as it gets, so wait here.
		if nav.partial then
			return 0, 0
		end
		return dx * strength, dz * strength
	end
	local px, pz = point.X - fromX, point.Y - fromZ
	local d = math.max(0.0001, math.sqrt(px * px + pz * pz))
	return px / d * strength, pz / d * strength
end

return Navigation
