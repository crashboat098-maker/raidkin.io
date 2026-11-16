--!strict
-- Game settings, shared by the server and every player's game.
-- Distances and speeds use the web version's units ("px"), so its tuning carries
-- over unchanged; STUDS_PER_PX converts them to Roblox studs when drawing.

local Config = {
	STUDS_PER_PX = 0.25,

	-- The server updates the game this many times a second, and sends a
	-- snapshot to players every SNAPSHOT_EVERY updates (30 / 2 = 15 a second).
	TICK_HZ = 30,
	SNAPSHOT_EVERY = 2,
	-- Players draw everything this far in the past, so movement can glide
	-- between two snapshots (about 1.6 snapshots' worth, as on the web).
	INTERPOLATION_S = 0.11,

	world = {
		-- The battlefield is a square this many px across (2816 px = 704 studs).
		size = 2816,
		-- Armies stay this far inside the edge.
		margin = 64,
	},

	-- Everyone wading through water moves at this share of their speed.
	water = { slowdown = 0.6 },

	-- How the army's invisible steering point moves. Like a normal Roblox character it
	-- starts and stops instantly: full speed (or a standstill) within a single frame.
	movement = {
		maxSpeed = 95,
		acceleration = 20000,
		deceleration = 20000,
	},

	army = {
		-- Bigger armies move slower: [size, share of maxSpeed], blended in between.
		speedCurve = {
			{ 1, 1 }, { 5, 0.91 }, { 10, 0.84 }, { 15, 0.78 }, { 20, 0.72 },
			{ 25, 0.66 }, { 30, 0.6 }, { 60, 0.55 }, { 100, 0.5 },
		},
		minSpeedMultiplier = 0.5,
		-- Distance between neighbouring formation spots.
		formationSpacing = 13,
		-- Soldier top speed (faster than the army, so they keep up).
		warriorSpeed = 108,
		-- Extra speed for a soldier that has fallen far behind its spot.
		catchUpMultiplier = 1.4,
		-- Guardians walk at this share of warriorSpeed (still a touch faster than the army).
		guardianSpeedMultiplier = 0.9,
		-- How quickly a soldier gets up to speed (it turns instantly).
		warriorAcceleration = 8000,
		-- Soldiers gently push apart when closer than this.
		separationDistance = 10,
		-- Every army starts as a single soldier.
		startingSoldiers = 1,
		-- Soul shards needed to recruit one Warrior.
		recruitCost = 5,
		-- Green crystals needed to recruit one Archer (their own separate progress).
		archerCost = 3,
		-- New recruits appear within this distance of the army's middle.
		recruitSpread = 40,

		-- SPACE splits every group with 2+ soldiers in half. All groups keep moving
		-- together; the army's speed comes from its LARGEST group, so splitting
		-- makes it faster. (From the web's GameConfig.army.split; times in seconds.)
		split = {
			minSoldiers = 2,
			-- Most groups an army can be divided into.
			maxClusters = 16,
			-- Minimum time between two splits (stops accidental double splits).
			cooldown = 0.2,
			-- A group heads back to the one it split from after
			-- min + soldiers x perSoldier seconds (at most max). A group waits for
			-- children already on their way back (at most maxWaitForReturn more),
			-- so merges cascade up into one army.
			regroup = { min = 3, perSoldier = 0.2, max = 18, maxWaitForReturn = 8 },
			-- The front half of each group shoots launchDistance past its partner,
			-- launchBoost times faster, for at most launchTime seconds.
			launchBoost = 2.2,
			launchTime = 0.7,
			launchDistance = 90,
			-- Smaller groups get this share of the extra speed their own size would give them.
			smallClusterBonus = 0.5,
			-- Groups pack together like agar.io cells, keeping this gap between their edges.
			clusterGap = 10,
			-- Group centres may move this much faster than the army to keep up.
			followSpeedMultiplier = 1.35,
		},
		-- If the bulk of the army falls this far behind the steering point, it slows down for them.
		leash = { startDistance = 36, fullStopDistance = 140 },
	},

	-- Soul shards: the collectible resource (from the web's GameConfig.soulShards).
	shards = {
		-- How many per million square px of playable ground.
		perMillionSquarePixels = 55,
		-- How close a soldier must get to pick one up.
		pickupRadius = 12,
		-- Shards try to keep at least this far apart.
		minSpacing = 40,
		-- A collected shard comes back somewhere else after this many seconds...
		respawnDelay = { min = 5, max = 9 },
		-- ...and never this close to a player.
		respawnAwayFromPlayers = 160,
		-- Share of shards that are rare green crystals (they recruit Archers).
		greenShare = 0.15,
	},

	-- Lone neutral Warriors wandering the map; any soldier who reaches one recruits it.
	neutrals = {
		wanderers = 36,
		-- How far a wanderer strays from its home spot, and how fast.
		wanderRadius = 40,
		wanderSpeed = 18,
		-- Any of your soldiers recruits a neutral within this distance.
		recruitRange = 26,
		-- A recruited neutral's spot stays empty for this many seconds...
		respawnDelay = { min = 30, max = 45 },
		-- ...and only refills when no player is this close.
		respawnPlayerClearance = 160,
	},

	-- Combat (from the web's GameConfig.combat; times in seconds). Soldiers fight
	-- automatically when armies meet: each strikes the nearest enemy in reach.
	combat = {
		maxHp = 100,
		-- Damage per blow, randomly varied by +/- damageVariance.
		damage = 14,
		damageVariance = 0.2,
		-- Melee reach (feet to feet), and time between blows (+/-10%).
		attackRange = 12,
		attackInterval = 0.5,
		-- Soldiers step out to fight enemies within engageRadius of themselves, but
		-- only ones within engageLeash of their own spot in the formation.
		engageRadius = 22,
		engageLeash = 30,
		-- After this long without dealing or taking damage, an army heals this share of health a second.
		regenDelay = 60,
		regenPerSecond = 0.05,
		-- Archers: less health, shoot arrows from behind the front line.
		archer = { maxHp = 60, damage = 11, range = 95, attackInterval = 0.9 },
		-- Guardians (won from castle wheels): heavy armour and a big shield. Lots of
		-- health, light blows, one swing a second; they hold the front line.
		guardian = { maxHp = 180, damage = 8, attackInterval = 1.0 },
		-- Split-off groups hit softer when small: { group size, share of damage }.
		-- 5 soldiers hit at half damage, 25 or more at full. The main group always hits at full.
		clusterDamage = { { 5, 0.5 }, { 25, 1 } },
	},

	-- Fallen soldiers leave a body; after `dormant` seconds any army can revive it
	-- by walking a soldier within reviveRange. Unclaimed bodies fade after `lifetime`.
	fallen = {
		dormant = 5,
		lifetime = 180,
		reviveRange = 20,
	},

	-- AI armies that play by the same rules as players (from the web's GameConfig.bots).
	bots = {
		names = { "KARWYN", "VELVASH", "VORHELM" },
		-- Their army colours (indexes into `colors`), and the most soldiers each grows to.
		colors = { 2, 3, 5 },
		maxSoldiers = { 65, 150, 50 },
		-- Beaten bots come back as one soldier after this many seconds.
		respawnDelay = 8,
		-- How far a bot notices armies, shards and recruits, and how often it re-thinks.
		sightRadius = 300,
		decisionInterval = 0.4,
		-- Hunt armies we're this many times stronger than; fight ones at least this
		-- share of us; flee from ones this many times stronger (strength = total health).
		huntRatio = 1.3,
		engageRatio = 0.85,
		fleeRatio = 1.5,
		-- Below this average health a bot avoids even fights.
		injuredHealthRatio = 0.5,
		fleeDuration = 4,
		-- Armies this big look for prey beyond their sight, this far.
		huntMinSize = 10,
		huntSearchRadius = 900,
		-- A chase that hasn't closed the gap for this long is dropped, and that army ignored for a while.
		pursuitGiveUp = 7,
		pursuitIgnore = 15,
		-- Armies this big go and spin castle wheels that are ready, within this distance.
		castleMinSize = 6,
		castleSearchRadius = 1500,
	},

	-- The three Lucky Spin castles (enchanted forest, volcano, swamp; see the server's Castles).
	castles = {
		-- Hold the circle this long (alone; another army pauses it, leaving resets it) to spin the wheel.
		chargeTime = 45,
		-- After a spin, the castle rests this long before it can be spun again.
		cooldown = 60,
		-- The wheel spins this long before the reward lands, and the result stays up this long.
		spinTime = 2.6,
		resultTime = 2.6,
		-- Who stands in each circle is checked this often (seconds).
		checkInterval = 0.1,
	},

	-- New and respawning armies start at least this far from any other army.
	spawnClearance = 360,

	-- Neutral (unrecruited) soldiers are drawn in this colour.
	neutralColor = Color3.fromRGB(150, 140, 120),

	-- Army colours, given out to players in join order.
	colors = {
		Color3.fromRGB(196, 40, 28), -- crimson
		Color3.fromRGB(13, 105, 172), -- blue
		Color3.fromRGB(245, 205, 48), -- gold
		Color3.fromRGB(75, 151, 75), -- green
		Color3.fromRGB(107, 50, 124), -- purple
		Color3.fromRGB(218, 133, 65), -- orange
		Color3.fromRGB(4, 175, 236), -- cyan
		Color3.fromRGB(255, 102, 204), -- pink
	},
}

return Config
