import * as THREE from 'three/webgpu';
import { createRng } from '../core/rng.js';
import { Rig } from '../characters/rig.js';
import { Animator, ZOMBIE_STYLE } from '../characters/animator.js';
import { makeFaceSet } from '../characters/faces.js';
import { ZOMBIES } from '../characters/specs.js';
import { PLAZA, SPIRE, AVENUE, QUAY_ROAD } from '../world/layout.js';

const _list = [];
const _v = new THREE.Vector3();
const SPEED_SHAMBLE = 1.1, SPEED_CHASE = 3.3;
const AGGRO = 26, LOSE = 40, ATTACK_RANGE = 1.45, ATTACK_TIME = 0.95;
const MAX_ZOMBIES = 64;
const ACTIVE_RADIUS = 140; // only simulate/animate within this distance of the player

// Urban alley scavengers. They prefer the shaded streets, shamble around at random, chase the kid
// when they notice her, and can't climb — rooftops are safe ground.
export class ZombieManager {

	constructor( scene, physics, atlas, city, rng = createRng( 31337 ) ) {

		this.scene = scene;
		this.physics = physics;
		this.rng = rng;
		this.group = new THREE.Group();
		this.group.name = 'zombies';
		scene.add( this.group );
		this.rigs = ZOMBIES.map( ( spec ) => ( { rig: new Rig( spec, atlas ), faces: makeFaceSet( spec ), spec } ) );
		this.zombies = [];
		this.killed = 0;
		this.spawnPoints = this.pickSpawnPoints( city );
		for ( let i = 0; i < Math.min( MAX_ZOMBIES, this.spawnPoints.length ); i ++ ) this.spawn( this.spawnPoints[ i ] );

	}

	pickSpawnPoints( city ) {

		const pts = [];
		const rng = this.rng;
		let guard = 0;
		while ( pts.length < MAX_ZOMBIES && guard ++ < 4000 ) {

			const x = rng.range( - 420, 185 ), z = rng.range( - 420, 380 );
			// not on the plaza (that's the safe start), not in the avenue, not on the quay road
			if ( x > PLAZA.x0 - 20 && x < PLAZA.x1 + 20 && z > PLAZA.z0 - 20 && z < PLAZA.z1 + 20 ) continue;
			if ( z > AVENUE.z0 - 6 && z < AVENUE.z1 + 6 ) continue;
			if ( x > QUAY_ROAD.x0 - 4 ) continue;
			if ( this.physics.solidAt( x, 0.5, z, _list ) ) continue;
			// must be in a street: a wall within ~8 m on at least one side, and some open space to move
			let walls = 0, open = 0;
			for ( const [ dx, dz ] of [ [ 6, 0 ], [ - 6, 0 ], [ 0, 6 ], [ 0, - 6 ] ] ) {

				if ( this.physics.solidAt( x + dx, 1, z + dz, _list ) ) walls ++;
				else open ++;

			}

			if ( walls === 0 || open === 0 ) continue;
			if ( pts.some( ( p ) => Math.hypot( p.x - x, p.z - z ) < 14 ) ) continue;
			pts.push( { x, z } );

		}

		void city;
		return pts;

	}

	spawn( p ) {

		const variant = this.rigs[ this.rng.int( 0, this.rigs.length - 1 ) ];
		const inst = variant.rig.createInstance();
		const anim = new Animator( inst, variant.spec, ZOMBIE_STYLE, this.physics, false );
		anim.setFaces( variant.faces );
		inst.root.position.set( p.x, this.physics.groundAt( p.x, p.z, 5, 0 ), p.z );
		inst.root.rotation.y = this.rng.range( 0, Math.PI * 2 );
		this.group.add( inst.root );
		const z = {
			inst, anim, variant,
			pos: inst.root.position,
			yaw: inst.root.rotation.y,
			vel: new THREE.Vector3(),
			hp: 3,
			state: 'wander', // wander | chase | attack | stagger | dead
			timer: this.rng.range( 1, 4 ),
			wanderYaw: inst.root.rotation.y,
			attackT: - 1,
			attackHit: false,
			staggerT: 0,
			deadT: 0,
			home: { x: p.x, z: p.z },
			speed: 0,
			grounded: true,
			vy: 0,
			growlT: this.rng.range( 2, 8 ),
			hitFlash: 0,
			active: false,
		};
		this.zombies.push( z );
		return z;

	}

	// Player kick: hits every live zombie in a short arc in front of the player.
	kick( playerPos, yaw, onHit ) {

		let hits = 0;
		for ( const z of this.zombies ) {

			if ( z.state === 'dead' ) continue;
			const dx = z.pos.x - playerPos.x, dz = z.pos.z - playerPos.z;
			const dist = Math.hypot( dx, dz );
			if ( dist > 2.1 || Math.abs( z.pos.y - playerPos.y ) > 1.4 ) continue;
			const fx = Math.sin( yaw ), fz = Math.cos( yaw );
			const dot = ( dx * fx + dz * fz ) / Math.max( dist, 1e-3 );
			if ( dot < 0.35 ) continue;
			z.hp -= 1;
			z.hitFlash = 1;
			z.vel.x += fx * 7;
			z.vel.z += fz * 7;
			z.vy = 2.5;
			z.grounded = false;
			if ( z.hp <= 0 ) {

				z.state = 'dead';
				z.deadT = 0;
				this.killed ++;
				onHit && onHit( z, true );

			} else {

				z.state = 'stagger';
				z.staggerT = 0.55;
				z.attackT = - 1;
				z.anim.setExpression( 'hurt', 0.8 );
				onHit && onHit( z, false );

			}

			hits ++;

		}

		return hits;

	}

	update( dt, player, onPlayerHit, sfx ) {

		const P = player.pos;
		for ( const z of this.zombies ) {

			const dx = P.x - z.pos.x, dz = P.z - z.pos.z;
			const dist = Math.hypot( dx, dz );
			const dy = P.y - z.pos.y;
			z.active = dist < ACTIVE_RADIUS;
			z.inst.root.visible = dist < 420;
			if ( ! z.active ) continue;

			// --- brain ----------------------------------------------------------------
			z.timer -= dt;
			let moveSpeed = 0, targetYaw = z.yaw;
			const canSee = dist < AGGRO && dy < 4.5 && dy > - 6;
			if ( z.state === 'dead' ) {

				z.deadT += dt;
				if ( z.deadT > 6 ) z.pos.y -= dt * 0.25; // sink away
				if ( z.deadT > 11 ) {

					// respawn elsewhere
					const sp = this.spawnPoints[ this.rng.int( 0, this.spawnPoints.length - 1 ) ];
					if ( Math.hypot( sp.x - P.x, sp.z - P.z ) > 40 ) {

						z.pos.set( sp.x, this.physics.groundAt( sp.x, sp.z, 5, 0 ), sp.z );
						z.hp = 3;
						z.state = 'wander';
						z.deadT = 0;
						z.vel.set( 0, 0, 0 );

					}

				}

			} else if ( z.state === 'stagger' ) {

				z.staggerT -= dt;
				if ( z.staggerT <= 0 ) z.state = 'chase';

			} else if ( z.state === 'attack' ) {

				z.attackT += dt / ATTACK_TIME;
				targetYaw = Math.atan2( dx, dz );
				if ( z.attackT > 0.42 && z.attackT < 0.62 && ! z.attackHit ) {

					// strike window
					if ( dist < ATTACK_RANGE + 0.5 && Math.abs( dy ) < 1.6 ) {

						z.attackHit = true;
						onPlayerHit( z, 18 );

					}

				}

				if ( z.attackT >= 1 ) {

					z.state = 'chase';
					z.attackT = - 1;
					z.timer = 0.4;

				}

			} else if ( z.state === 'chase' ) {

				targetYaw = Math.atan2( dx, dz );
				if ( dist > LOSE || dy > 6 ) {

					z.state = 'wander';
					z.timer = 1;

				} else if ( dist < ATTACK_RANGE && Math.abs( dy ) < 1.6 && z.timer <= 0 ) {

					z.state = 'attack';
					z.attackT = 0;
					z.attackHit = false;
					z.anim.setExpression( 'rage', 1.2 );
					if ( sfx && dist < 30 ) sfx.play( 'zombieAttack' );

				} else if ( dist > ATTACK_RANGE * 0.8 ) {

					moveSpeed = SPEED_CHASE * ( dy > 2.5 ? 0.4 : 1 );

				}

				z.growlT -= dt;
				if ( z.growlT < 0 ) {

					z.growlT = this.rng.range( 3, 7 );
					if ( sfx && dist < 25 ) sfx.play( 'growl' );

				}

			} else {

				// wander
				if ( canSee && ( player.vel.lengthSq() > 4 || dist < AGGRO * 0.5 ) ) {

					z.state = 'chase';
					z.timer = 0.3;
					z.anim.setExpression( 'rage', 1.5 );
					if ( sfx && dist < 30 ) sfx.play( 'growl' );

				} else {

					if ( z.timer <= 0 ) {

						z.timer = this.rng.range( 2, 6 );
						if ( this.rng.chance( 0.55 ) ) {

							// drift toward home so they stay in their alley
							const hx = z.home.x - z.pos.x, hz = z.home.z - z.pos.z;
							z.wanderYaw = Math.hypot( hx, hz ) > 25 ? Math.atan2( hx, hz ) : this.rng.range( 0, Math.PI * 2 );
							z.wandering = true;

						} else {

							z.wandering = false;

						}

					}

					if ( z.wandering ) {

						moveSpeed = SPEED_SHAMBLE;
						targetYaw = z.wanderYaw;

					}

				}

			}

			// --- motion ---------------------------------------------------------------
			let d = targetYaw - z.yaw;
			d = Math.atan2( Math.sin( d ), Math.cos( d ) );
			z.yaw += d * Math.min( 1, dt * ( z.state === 'chase' ? 4 : 2 ) );
			const fx = Math.sin( z.yaw ), fz = Math.cos( z.yaw );
			const k = Math.min( 1, dt * 5 );
			z.vel.x += ( fx * moveSpeed - z.vel.x ) * k;
			z.vel.z += ( fz * moveSpeed - z.vel.z ) * k;
			if ( ! z.grounded ) {

				z.vy -= 24 * dt;

			}

			const nx = z.pos.x + z.vel.x * dt, nz = z.pos.z + z.vel.z * dt;
			// walls: simple circle push-out
			if ( ! this.physics.solidAt( nx, z.pos.y + 0.6, nz, _list ) ) {

				z.pos.x = nx;
				z.pos.z = nz;

			} else if ( ! this.physics.solidAt( nx, z.pos.y + 0.6, z.pos.z, _list ) ) {

				z.pos.x = nx;
				z.vel.z *= - 0.2;
				if ( z.state === 'wander' ) z.timer = 0;

			} else if ( ! this.physics.solidAt( z.pos.x, z.pos.y + 0.6, nz, _list ) ) {

				z.pos.z = nz;
				z.vel.x *= - 0.2;
				if ( z.state === 'wander' ) z.timer = 0;

			} else {

				z.vel.multiplyScalar( - 0.2 );
				if ( z.state === 'wander' ) z.timer = 0;

			}

			const g = this.physics.groundAt( z.pos.x, z.pos.z, z.pos.y + 0.6, 0.6, _list );
			if ( z.state !== 'dead' || z.deadT < 6 ) {

				if ( z.grounded ) {

					z.pos.y = g > - 40 ? g : z.pos.y;

				} else {

					z.pos.y += z.vy * dt;
					if ( z.pos.y <= g ) {

						z.pos.y = g;
						z.grounded = true;
						z.vy = 0;

					}

				}

			}

			z.speed = Math.hypot( z.vel.x, z.vel.z );
			z.hitFlash = Math.max( 0, z.hitFlash - dt * 4 );

			// --- animation -----------------------------------------------------------
			z.inst.root.rotation.y = z.yaw;
			z.anim.update( dt, {
				speed: z.state === 'dead' ? 0 : z.speed,
				run: z.state === 'chase',
				grounded: z.grounded || z.state === 'dead',
				vy: z.vy,
				climbing: false,
				swimming: false,
				flip: 0,
				landed: 0,
				turnRate: 0,
				attack: z.state === 'attack' ? z.attackT : - 1,
				attackKind: 'lunge',
				hit: z.state === 'stagger' && z.staggerT > 0.5,
				dead: z.state === 'dead',
				lookAt: canSee && z.state !== 'dead' ? _v.set( P.x, P.y + 1.4, P.z ) : null,
				climbVy: 0,
			} );

		}

		// shared hit flash: the variant material is shared, flash the strongest one
		for ( const v of this.rigs ) {

			let f = 0;
			for ( const z of this.zombies ) if ( z.variant === v ) f = Math.max( f, z.hitFlash );
			v.rig.material.hitFlash.value = f * 0.6;

		}

	}

	nearestThreat( pos ) {

		let best = Infinity;
		for ( const z of this.zombies ) {

			if ( z.state !== 'chase' && z.state !== 'attack' ) continue;
			best = Math.min( best, z.pos.distanceTo( pos ) );

		}

		return best;

	}

}

export { SPIRE };
