/**
 * Central tuning values for RAIDKIN.IO.
 * Change numbers here instead of hunting through the code.
 *
 * Units: "world pixels". The art is drawn at native retro resolution
 * (16x16 tiles) and the camera zooms in to make it chunky on screen.
 */
export const GameConfig = {
    /** Size of the game canvas before it is scaled to fit the browser window. */
    screen: {
        // 16:9 widescreen. With camera zoom 2 the player sees 640 x 360 world
        // pixels (wider than the old 4:3 view of 512 x 384).
        width: 1280,
        height: 720,
    },

    camera: {
        /** Zoom at the start of a match (2 = every art pixel becomes a 2x2 block on screen). */
        zoom: 2.6,
        /** 0..1 â€” lower is a softer, more delayed camera follow. */
        followLerp: 0.3,
        /**
         * Dynamic zoom: close in for small armies, out for big or split ones.
         * The camera keeps the army's actual spread (all clusters) on screen.
         */
        maxZoom: 2.6,
        minZoom: 1,
        /** Keep this many times the army's spread visible around its centre... */
        spreadMargin: 2.4,
        /** ...plus this much extra room (world px) to see what's coming. */
        paddingWorld: 60,
        /** How quickly the zoom follows changes (per second). Zooming out reacts faster than zooming in. */
        zoomOutRate: 1.6,
        zoomInRate: 0.7,
    },

    world: {
        /** Same seed = same map every time (handy for multiplayer later). */
        seed: 20261108,
        tileSize: 16,
        widthInTiles: 120,
        heightInTiles: 120,
        /** Thickness of the forest edge armies cannot enter. */
        borderTiles: 4,
        /** Keep this area around the spawn point free of decorations. */
        spawnClearRadius: 80,
        /** Medieval villages scattered around the map (houses, well, fences, villagers to recruit). */
        villages: 4,
        /** Recruitable villagers per village (wilderness spots have 1 each). */
        villagersPerVillage: { min: 4, max: 6 },
        /** Winding rivers crossing the map, smaller streams, and ponds. */
        water: { rivers: 2, streams: 3, ponds: 4 },
        /**
         * The map above (120 x 120 tiles) is the preserved centre. The world is
         * this many tiles bigger on every side, and its four corners are biomes
         * (enchanted forest top-left, volcano top-right; the bottom two are not built yet).
         */
        expandTiles: 28,
        /** How far each corner biome reaches from its corner (world px). */
        biomeRadius: 1000,
        /** Recruitable folk in the enchanted forest's village (more than a medieval village)... */
        faeVillagers: { min: 8, max: 10 },
        /** ...and roaming its woods. */
        forestFolk: 6,
        /** Recruitable folk in each ash village of the volcanic wastes. */
        ashVillagers: { min: 5, max: 7 },
        /** Lava rivers flowing from the volcano, and the spacing of their extra wide bridges (world px). */
        lavaRivers: 3,
        lavaBridgeSpacing: 260,
    },

    /** Shallow water: walkable by everyone, but slow. */
    water: {
        /** Speed multiplier while standing in water (soldiers, armies, bots, neutrals). */
        slowdown: 0.6,
    },

    /** How the active army cluster's (invisible) movement centre moves. */
    movement: {
        /** World pixels per second at full speed, with a 1-soldier army. */
        maxSpeed: 95,
        /** How quickly the army reaches full speed (and turns: higher = snappier, lower = icier). */
        acceleration: 1500,
        /** How quickly the army stops after releasing the keys. */
        deceleration: 1700,
    },

    soulShards: {
        /**
         * How many shards per million square world pixels of walkable map.
         * 55 gives about 175 shards on the current map, and scales if the map changes size.
         */
        perMillionSquarePixels: 55,
        /** How close (world pixels) a soldier of the active cluster must get to collect a shard. */
        pickupRadius: 12,
        /** Shards try to keep at least this far apart. */
        minSpacing: 40,
        /** A collected shard reappears somewhere else after a random delay in this range. */
        respawnDelayMs: { min: 5000, max: 9000 },
        /** Shards never respawn this close to a player (no "free" instant re-collection). */
        respawnAwayFromPlayers: 160,
        /** Share of shards that are rare green crystals (recruit Archers instead of Warriors). */
        greenShare: 0.15,
    },

    army: {
        // There is NO limit on army size (Milestone 5). Armies grow as large as players can earn.

        /** Soul Shards needed to recruit one Warrior. */
        recruitCost: 5,
        /** Green crystals needed to recruit one Archer (their own separate progress). */
        archerCost: 3,
        /**
         * Speed multiplier by the LARGEST cluster's size: [soldiers, multiplier].
         * Values in between are blended smoothly. Bigger cluster = slower,
         * easing off past 30 so huge armies stay playable.
         */
        speedCurve: [[1, 1], [5, 0.91], [10, 0.84], [15, 0.78], [20, 0.72], [25, 0.66], [30, 0.6], [60, 0.55], [100, 0.5]] as const,
        /** The army never goes slower than this multiplier, however big it gets. */
        minSpeedMultiplier: 0.5,

        /**
         * SPACE splits every cluster with 2+ soldiers in half. All clusters
         * keep moving together; army speed comes from the LARGEST cluster.
         */
        split: {
            /** A cluster needs at least this many soldiers to be split. */
            minSoldiers: 2,
            /** Most clusters an army can be divided into. */
            maxClusters: 16,
            /** Minimum time between two splits (ms); just enough to stop accidental double splits. */
            cooldownMs: 200,
            /**
             * After a split, each cluster returns to the cluster it split from.
             * Small clusters return sooner, big ones later:
             * delay = minMs + soldiers x perSoldierMs, capped at maxMs (counted
             * from the cluster's last split, and growing as children rejoin it).
             * A cluster waits for children already on their way back (at most
             * maxWaitForReturnMs extra), so merges cascade up into one army.
             */
            regroup: { minMs: 3000, perSoldierMs: 200, maxMs: 18_000, maxWaitForReturnMs: 8000 },
            /**
             * A split is aimed at the mouse: the front half of each cluster breaks
             * off and shoots launchDistance px past its parent's edge, launchBoost
             * times faster, for at most launchMs. Then it falls back into the blob.
             */
            launchBoost: 2.2,
            launchMs: 700,
            launchDistance: 90,
            /**
             * Smaller split clusters move a little faster than the army: they get
             * this share of the extra speed their own size would give them on the
             * speedCurve (0 = all clusters equal, 1 = full size-based speed).
             */
            smallClusterBonus: 0.5,
            /**
             * Split clusters all head for the same point (where you steer) and
             * push each other apart, so they pack into one tight blob like
             * agar.io cells. This is the gap kept between their edges (world px).
             */
            clusterGap: 10,
            /** Cluster centres may move this much faster than the army to keep up / converge. */
            followSpeedMultiplier: 1.35,
            /** How often each cluster re-plans its route around obstacles (ms). */
            replanMs: 300,
        },
        /** If soldiers fall this far behind the steering centre, it slows down until they catch up. */
        leash: { startDistance: 36, fullStopDistance: 140 },

        /** Distance between neighbouring formation spots (world pixels). */
        formationSpacing: 13,
        /** Warrior top speed. Faster than the army's movement so they can keep up. */
        warriorSpeed: 108,
        /**
         * Guardians are slower than Warriors (108 x 0.9 = 97 px/s), but still a
         * touch faster than the army itself ever moves (95), so they never slow it down.
         */
        guardianSpeedMultiplier: 0.9,
        /** Extra speed multiplier when a Warrior has fallen far behind. */
        catchUpMultiplier: 1.4,
        /** How quickly a Warrior speeds up and turns (higher = snappier, lower = icier). */
        warriorAcceleration: 1400,
        /** Warriors gently push apart when closer than this. */
        separationDistance: 10,
        /** How often each Warrior re-plans its route (ms). Staggered across Warriors. */
        thinkIntervalMs: 220,
        /**
         * Breadcrumbs: the cluster centre's recent path, used to lead Warriors
         * around obstacles, and to guide returning groups back along a known
         * walkable route (200 x 10px = the last ~2000px travelled).
         */
        trailSpacing: 10,
        trailLength: 200,
        /**
         * Emergency recovery for a Warrior that is badly separated (e.g. wedged
         * somewhere odd): re-place it safely near its cluster. Should be rare.
         */
        recovery: { enabled: true, afterMs: 6000, minDistance: 260 },
    },

    combat: {
        /** Health of every Warrior. */
        maxHp: 100,
        /** Damage per hit, randomly varied by +/- this fraction. */
        damage: 14,
        damageVariance: 0.2,
        /** Soldiers hit enemies within this distance (world px, feet to feet). */
        attackRange: 12,
        /** Time between a soldier's attacks (ms), slightly randomised (+/-10%). */
        attackIntervalMs: 500,
        /** Soldiers move to fight enemies within this distance of themselves... */
        engageRadius: 22,
        /** ...but only enemies within this distance of the soldier's own spot in the formation. */
        engageLeash: 30,
        /** An army starts healing after this long without dealing or taking damage (ms). */
        regenDelayMs: 60_000,
        /** Healing speed once it starts: fraction of max health per second. */
        regenPerSecond: 0.05,
        // The human player does not respawn: losing the last soldier shows the defeat screen.
        /**
         * Archers (recruited with green crystals): less health than a Warrior,
         * shooting arrows at enemies within `range` from behind the front line.
         */
        archer: { maxHp: 60, damage: 11, range: 95, attackIntervalMs: 900 },
        /**
         * Guardians (won from castle Lucky Spins): heavy armour and a big shield.
         * Lots of health, light blows, one swing a second; they hold the front line.
         */
        guardian: { maxHp: 180, damage: 8, attackIntervalMs: 1000 },
        /**
         * Split-off clusters hit softer when small: [cluster size, share of damage].
         * 5 soldiers hit at half damage, 25 or more at full. The main cluster always hits at full.
         */
        clusterDamage: [[5, 0.5], [25, 1]] as const,
    },

    /**
     * The three Lucky Spin castles (enchanted forest, volcanic wastes, swamp).
     * Holding a ready castle's circle for `chargeMs` spins its reward wheel (rewards and
     * their chances: SPIN_REWARDS in logic/Castles.ts).
     */
    castles: {
        /** Hold the circle this long (alone; another army pauses it, leaving resets it) to spin the wheel. */
        chargeMs: 45_000,
        /** After a spin, the castle rests this long before it can be spun again. */
        cooldownMs: 60_000,
        /** The wheel spins this long before the reward lands... */
        spinMs: 2600,
        /** ...and the result stays up this long afterwards. */
        resultMs: 2600,
        /** Who stands in each circle is checked this often (ms), not every frame. */
        checkIntervalMs: 100,
    },

    bots: {
        /** AI opponents that play like the human: 1 human + 3 bots = 4 competitors. */
        count: 3,
        /** Soldiers each bot starts with (same as the human, for a fair match). Raise for testing big fights. */
        startingSize: 1,
        /**
         * Most soldiers each bot's army grows to, in bot order. With the default
         * map seed the bots are KARWYN, VELVASH (the yellow one) and VORHELM.
         * A full bot stops collecting shards and recruits, and just roams and fights.
         */
        maxSoldiers: [65, 150, 50] as readonly number[],
        /** Eliminated bots come back with this many soldiers and a fresh score. */
        respawnSize: 1,
        respawnDelayMs: 8000,
        /** How far a bot notices other armies, shards and neutrals (world px). */
        sightRadius: 300,
        /** How often a bot re-thinks what to do (ms). */
        decisionMs: 400,

        // --- Sizing up an enemy (strength = total remaining health) ---
        /** Hunt armies we're at least this many times stronger than... */
        huntRatio: 1.3,
        /** ...fight armies roughly our size (at least this fraction of us) when healthy... */
        engageRatio: 0.85,
        /** ...and flee from armies this many times stronger than us. */
        fleeRatio: 1.5,
        /** Below this average health, a bot avoids even fights and goes to recover. */
        injuredHealthRatio: 0.5,
        /** How long a flight lasts before re-thinking (ms). */
        fleeDurationMs: 4000,

        // --- Hunting ---
        /** Armies this big go looking for prey beyond their sight. */
        huntMinSize: 10,
        /** How far a big bot searches for prey (world px). */
        huntSearchRadius: 900,
        /** Give up a chase that hasn't closed the gap for this long (ms)... */
        pursuitGiveUpMs: 7000,
        /** ...and ignore that army for this long afterwards (ms). */
        pursuitIgnoreMs: 15000,

        // --- Castles ---
        /** Armies this big go spin castle wheels that are ready... */
        castleMinSize: 6,
        /** ...within this distance of their army (world px). */
        castleSearchRadius: 1500,

        /** New armies spawn at least this far from any other army (no spawn camping). */
        spawnClearance: 360,
    },

    neutrals: {
        /** Lone neutral Warriors wandering the map (scaled up with the larger map). */
        wanderers: 36,
        /** How far a wanderer strays from its home spot. */
        wanderRadius: 40,
        wanderSpeed: 18,
        /** Neutral Warriors stationed outside each barracks. */
        garrisonPerBarracks: { min: 2, max: 3 },
        /** Any soldier of the active cluster recruits neutrals within this distance. */
        recruitRange: 26,
        /** After being recruited, a spot stays empty for this long (ms)... */
        respawnDelayMs: { min: 30000, max: 45000 },
        /** ...and only refills when no player is this close (no instant farming). */
        respawnPlayerClearance: 160,
        /**
         * Surrender (Q or right-click): one soldier leaves the army toward the
         * mouse pointer, walking this far (world px) past where it stood. It turns
         * neutral and can be recruited by anyone, its old army too, once
         * `fallen.dormantMs` has passed (the same wait as reviving the fallen).
         */
        surrender: { releaseDistance: 56 },
    },

    /**
     * Lava rivers (volcanic wastes) can be walked across, but each soldier standing
     * in molten lava loses `burnDamage` health every `burnIntervalMs` (and doesn't
     * heal meanwhile). Lava pools stay solid. Bridges are perfectly safe.
     */
    lava: {
        burnDamage: 2,
        burnIntervalMs: 500,
    },

    /** Fallen soldiers: the dead leave bodies that any army can revive and recruit. */
    fallen: {
        /** A body can't be revived until it has lain this long (ms). */
        dormantMs: 5000,
        /** Unclaimed bodies fade away after this long (ms). */
        lifetimeMs: 180_000,
        /** Any soldier this close to a recruitable body revives it. */
        reviveRange: 20,
    },
} as const;
