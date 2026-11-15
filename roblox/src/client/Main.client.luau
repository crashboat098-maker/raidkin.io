--!strict
-- Each player's game: steering, the top-down camera, and drawing the armies.
--
-- Steer with the mouse (point where to go; near the middle of the screen
-- stops) or with WASD / the arrow keys. The server moves the armies; this
-- script draws them a little in the past (Config.INTERPOLATION_S) so they glide
-- smoothly between the server's snapshots.

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Version = require(Shared:WaitForChild("Version"))
local ArmyView = require(script.Parent:WaitForChild("ArmyView"))
local ShardView = require(script.Parent:WaitForChild("ShardView"))
local Hud = require(script.Parent:WaitForChild("Hud"))

local player = Players.LocalPlayer
local camera = Workspace.CurrentCamera
local remotes = ReplicatedStorage:WaitForChild("Remotes")
local steerRemote = remotes:WaitForChild("Steer") :: RemoteEvent
local snapshotRemote = remotes:WaitForChild("Snapshot") :: RemoteEvent
local shardRemote = remotes:WaitForChild("ShardSync") :: RemoteEvent
local statsRemote = remotes:WaitForChild("Stats") :: RemoteEvent

-- Shards: every one once (asked for below, now that we're listening), then changes.
shardRemote.OnClientEvent:Connect(function(message)
	ShardView.apply(message.shards)
end)
statsRemote.OnClientEvent:Connect(function(stats)
	Hud.show(stats)
end)
shardRemote:FireServer()

local S = Config.STUDS_PER_PX

-- ---------------------------------------------------------------------------
-- Snapshots from the server
-- ---------------------------------------------------------------------------

type Snapshot = { t: number, armies: { ArmyView.ArmyState } }
local snapshots: { Snapshot } = {}

-- Unpacks the server's flat soldier lists ({ id, x, z, yaw, moving, archer, ... }).
snapshotRemote.OnClientEvent:Connect(function(message)
	local armies = {}
	for _, a in message.armies do
		local soldiers: { [number]: ArmyView.SoldierState } = {}
		local flat = a.soldiers
		for i = 1, #flat, 6 do
			soldiers[flat[i]] = { x = flat[i + 1], z = flat[i + 2], yaw = flat[i + 3], moving = flat[i + 4] == 1, archer = flat[i + 5] == 1 }
		end
		table.insert(armies, { id = a.id, color = a.color, cx = a.cx, cz = a.cz, soldiers = soldiers })
	end
	table.insert(snapshots, { t = message.t, armies = armies })
	if #snapshots > 10 then
		table.remove(snapshots, 1)
	end
end)

-- The armies as they were at `renderTime`, blended between the two snapshots either side of it.
local function blendedArmies(renderTime: number): { ArmyView.ArmyState }
	local count = #snapshots
	if count == 0 then
		return {}
	end
	local older, newer = snapshots[1], snapshots[count]
	for i = count, 2, -1 do
		if snapshots[i - 1].t <= renderTime then
			older, newer = snapshots[i - 1], snapshots[i]
			break
		end
	end
	local span = newer.t - older.t
	local a = if span > 0 then math.clamp((renderTime - older.t) / span, 0, 1) else 1

	local before: { [number]: ArmyView.ArmyState } = {}
	for _, army in older.armies do
		before[army.id] = army
	end
	local result = {}
	for _, army in newer.armies do
		local prev = before[army.id]
		local soldiers: { [number]: ArmyView.SoldierState } = {}
		for id, s in army.soldiers do
			local p = prev and prev.soldiers[id]
			if p then
				soldiers[id] = { x = p.x + (s.x - p.x) * a, z = p.z + (s.z - p.z) * a, yaw = s.yaw, moving = s.moving, archer = s.archer }
			else
				soldiers[id] = s
			end
		end
		local cx = if prev then prev.cx + (army.cx - prev.cx) * a else army.cx
		local cz = if prev then prev.cz + (army.cz - prev.cz) * a else army.cz
		table.insert(result, { id = army.id, color = army.color, cx = cx, cz = cz, soldiers = soldiers })
	end
	return result
end

-- ---------------------------------------------------------------------------
-- Steering
-- ---------------------------------------------------------------------------

-- Mouse steering ignores the pointer this close to the middle of the screen (pixels).
local MOUSE_DEADZONE = 25
local SEND_EVERY = 1 / 20

local function readSteering(): (number, number)
	local x = 0
	local z = 0
	if UserInputService:IsKeyDown(Enum.KeyCode.D) or UserInputService:IsKeyDown(Enum.KeyCode.Right) then x += 1 end
	if UserInputService:IsKeyDown(Enum.KeyCode.A) or UserInputService:IsKeyDown(Enum.KeyCode.Left) then x -= 1 end
	if UserInputService:IsKeyDown(Enum.KeyCode.S) or UserInputService:IsKeyDown(Enum.KeyCode.Down) then z += 1 end
	if UserInputService:IsKeyDown(Enum.KeyCode.W) or UserInputService:IsKeyDown(Enum.KeyCode.Up) then z -= 1 end
	if x ~= 0 or z ~= 0 then
		local length = math.sqrt(x * x + z * z)
		return x / length, z / length
	end

	-- The mouse: steer toward the pointer. The camera looks north (screen up = -z).
	if UserInputService.MouseEnabled then
		local mouse = UserInputService:GetMouseLocation()
		local middle = camera.ViewportSize / 2
		local dx, dy = mouse.X - middle.X, mouse.Y - middle.Y
		local length = math.sqrt(dx * dx + dy * dy)
		if length > MOUSE_DEADZONE then
			return dx / length, dy / length
		end
	end
	return 0, 0
end

local lastSentX, lastSentZ, lastSentAt = 0, 0, 0
local function sendSteering(now: number)
	if now - lastSentAt < SEND_EVERY then
		return
	end
	local x, z = readSteering()
	-- Resend now and then even when unchanged, in case a message was lost.
	if x == lastSentX and z == lastSentZ and now - lastSentAt < 0.5 then
		return
	end
	lastSentX, lastSentZ, lastSentAt = x, z, now
	steerRemote:FireServer(x, z)
end

-- ---------------------------------------------------------------------------
-- Camera
-- ---------------------------------------------------------------------------

-- Seen from above and a little south, tilted like the web version's top-down view.
local CAMERA_PITCH = math.rad(62)
local cameraDistance = 70
local focus = Vector3.new(Config.world.size * S / 2, 0, Config.world.size * S / 2)

local function updateCamera(army: ArmyView.ArmyState?, dt: number)
	camera.CameraType = Enum.CameraType.Scriptable
	if army then
		local count = 0
		for _ in army.soldiers do
			count += 1
		end
		-- Pull back as the army grows, so it always fits on screen.
		local wanted = 55 + math.sqrt(count) * 6
		cameraDistance += (wanted - cameraDistance) * math.min(1, dt * 1.5)
		-- Locked on the army (no trailing), like the web version.
		focus = Vector3.new(army.cx * S, 0, army.cz * S)
	end
	local offset = Vector3.new(0, math.sin(CAMERA_PITCH), math.cos(CAMERA_PITCH)) * cameraDistance
	camera.CFrame = CFrame.lookAt(focus + offset, focus)
end

-- ---------------------------------------------------------------------------
-- Every frame
-- ---------------------------------------------------------------------------

RunService.RenderStepped:Connect(function(dt)
	local now = os.clock()
	sendSteering(now)

	local armies = blendedArmies(Workspace:GetServerTimeNow() - Config.INTERPOLATION_S)
	local mine: ArmyView.ArmyState? = nil
	for _, army in armies do
		if army.id == player.UserId then
			mine = army
		end
	end
	updateCamera(mine, dt)
	ArmyView.draw(armies, now)
end)

print(`[{Version.name}] client ready, version {Version.version}`)
