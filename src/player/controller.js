import * as THREE from 'three/webgpu';
import { WATER_Y } from '../world/layout.js';

const RADIUS = 0.32;
const HEIGHT = 1.6;
const STEP = 0.45;
const GRAVITY = 24;
const WALK = 3.4, RUN = 7.6, SWIM = 2.8;
const JUMP_V = 8.4, DOUBLE_V = 7.6;
const CLIMB_V = 4.2;
const CLIMB_TIME = 8; // seconds of stamina

const _list = [];
const _wish = new THREE.Vector3();

export class PlayerController {

	constructor( physics, spawn ) {

		this.physics = physics;
		this.pos = new THREE.Vector3( spawn.x, 0, spawn.z );
		this.vel = new THREE.Vector3();
		this.yaw = spawn.yaw || 0;
		this.spawn = { ...spawn };
		this.grounded = true;
		this.climbing = false;
		this.swimming = false;
		this.stamina = 1;
		this.jumps = 1;
		this.coyote = 0;
		this.jumpBuffer = 0;
		this.climbLock = 0;
		this.flip = 0;
		this.landed = 0;
		this.turnRate = 0;
		this.wall = null;
		this.wallN = new THREE.Vector3();
		this.events = [];
		this.maxHeight = 0;
		// combat
		this.hp = 100;
		this.maxHp = 100;
		this.attackT = - 1;
		this.attackHitDone = false;
		this.hitTimer = 0;
		this.invuln = 0;
		this.sinceDamage = 10;
		this.dead = false;
		this.deadT = 0;
		this.deaths = 0;
		this.hitFlag = false;
		this.pos.y = physics.groundAt( this.pos.x, this.pos.z, 100, 0 );

	}

	// intent: {x (right), y (forward)} in camera space; camYaw orbit angle
	update( dt, intent, camYaw, run, jumpPressed, attackPressed = false ) {

		this.events.length = 0;
		this.landed = 0;
		this.hitFlag = false;
		this.invuln = Math.max( 0, this.invuln - dt );
		this.hitTimer = Math.max( 0, this.hitTimer - dt );
		this.sinceDamage += dt;
		if ( this.sinceDamage > 5 && this.hp < this.maxHp && ! this.dead ) this.hp = Math.min( this.maxHp, this.hp + dt * 7 );

		if ( this.dead ) {

			this.deadT += dt;
			intent = { x: 0, y: 0 };
			jumpPressed = false;
			attackPressed = false;
			this.vel.x *= 1 - Math.min( 1, dt * 6 );
			this.vel.z *= 1 - Math.min( 1, dt * 6 );
			if ( this.deadT > 3.2 ) this.revive();

		}

		if ( attackPressed && this.attackT < 0 && ! this.climbing && ! this.swimming && this.hitTimer <= 0 ) {

			this.attackT = 0;
			this.attackHitDone = false;
			this.events.push( 'kick' );

		}

		if ( this.attackT >= 0 ) {

			this.attackT += dt / 0.55;
			if ( this.attackT >= 1 ) this.attackT = - 1;
			// a kick roots the feet a little
			intent = { x: intent.x * 0.35, y: intent.y * 0.35 };

		}

		if ( this.hitTimer > 0 ) intent = { x: 0, y: 0 };

		if ( jumpPressed ) this.jumpBuffer = 0.14;
		const steps = Math.ceil( dt / ( 1 / 120 ) );
		const h = dt / steps;
		for ( let i = 0; i < steps; i ++ ) this.step( h, intent, camYaw, run );
		if ( this.pos.y < - 40 ) this.respawn();
		this.maxHeight = Math.max( this.maxHeight, this.pos.y );

	}

	respawn() {

		this.pos.set( this.spawn.x, 0, this.spawn.z );
		this.pos.y = this.physics.groundAt( this.pos.x, this.pos.z, 100, 0 );
		this.vel.set( 0, 0, 0 );
		this.climbing = false;
		this.attackT = - 1;

	}

	revive() {

		this.dead = false;
		this.deadT = 0;
		this.hp = this.maxHp;
		this.invuln = 2.5;
		this.respawn();
		this.events.push( 'revive' );

	}

	// the kick's active window: true exactly once per swing
	get kickLanding() {

		if ( this.attackT < 0 || this.attackHitDone ) return false;
		if ( this.attackT > 0.3 ) {

			this.attackHitDone = true;
			return true;

		}

		return false;

	}

	damage( amount, from ) {

		if ( this.invuln > 0 || this.dead ) return false;
		this.hp -= amount;
		this.sinceDamage = 0;
		this.invuln = 0.7;
		this.hitTimer = 0.35;
		this.hitFlag = true;
		this.attackT = - 1;
		this.climbing = false;
		if ( from ) {

			const dx = this.pos.x - from.x, dz = this.pos.z - from.z;
			const l = Math.hypot( dx, dz ) || 1;
			this.vel.x += dx / l * 5.5;
			this.vel.z += dz / l * 5.5;
			this.vel.y = Math.max( this.vel.y, 2.8 );
			this.grounded = false;

		}

		this.events.push( 'hurt' );
		if ( this.hp <= 0 ) {

			this.hp = 0;
			this.dead = true;
			this.deadT = 0;
			this.deaths ++;
			this.events.push( 'die' );

		}

		return true;

	}

	step( dt, intent, camYaw, run ) {

		const fx = - Math.sin( camYaw ), fz = - Math.cos( camYaw );
		const rx = Math.cos( camYaw ), rz = - Math.sin( camYaw );
		_wish.set( rx * intent.x + fx * intent.y, 0, rz * intent.x + fz * intent.y );
		const intentLen = Math.min( 1, _wish.length() );
		if ( intentLen > 0.001 ) _wish.normalize();

		this.jumpBuffer -= dt;
		this.coyote -= dt;
		this.climbLock -= dt;
		if ( this.flip > 0 ) this.flip = Math.max( 0, this.flip - dt * 2.2 );

		const groundY = this.physics.groundAt( this.pos.x, this.pos.z, this.pos.y, STEP, _list );
		this.swimming = ! this.climbing && groundY < WATER_Y && this.pos.y < WATER_Y - 0.95;

		if ( this.climbing ) {

			this.climbStep( dt, intentLen, run );

		} else {

			const speed = this.swimming ? SWIM : ( run ? RUN : WALK );
			const accel = this.grounded ? 42 : ( this.swimming ? 8 : 12 );
			const tx = _wish.x * speed * intentLen, tz = _wish.z * speed * intentLen;
			const k = Math.min( 1, accel * dt / Math.max( 0.001, speed ) );
			this.vel.x += ( tx - this.vel.x ) * k;
			this.vel.z += ( tz - this.vel.z ) * k;

			if ( this.swimming ) {

				const target = WATER_Y - 1.18;
				this.vel.y += ( ( target - this.pos.y ) * 22 - this.vel.y * 5 ) * dt;
				this.stamina = Math.min( 1, this.stamina + dt * 0.15 );

			} else {

				this.vel.y -= GRAVITY * dt;

			}

			// jumping
			if ( this.jumpBuffer > 0 ) {

				if ( this.grounded || this.coyote > 0 ) {

					this.vel.y = JUMP_V * ( run ? 1.03 : 1 );
					this.grounded = false;
					this.coyote = 0;
					this.jumpBuffer = 0;
					this.jumps = 1;
					this.events.push( 'jump' );

				} else if ( this.swimming ) {

					this.vel.y = 5.2;
					this.jumpBuffer = 0;
					this.events.push( 'splash' );

				} else if ( this.jumps > 0 ) {

					this.vel.y = DOUBLE_V;
					this.jumps = 0;
					this.flip = 1;
					this.jumpBuffer = 0;
					this.events.push( 'double' );

				}

			}

			// face movement direction
			if ( intentLen > 0.05 ) {

				const target = Math.atan2( _wish.x, _wish.z );
				let d = target - this.yaw;
				d = Math.atan2( Math.sin( d ), Math.cos( d ) );
				const turn = Math.sign( d ) * Math.min( Math.abs( d ), dt * ( this.grounded ? 13 : 7 ) );
				this.yaw += turn;
				this.turnRate = THREE.MathUtils.lerp( this.turnRate, turn / dt, 0.1 );

			} else {

				this.turnRate *= 0.9;

			}

		}

		// integrate horizontal, resolve walls
		this.pos.x += this.vel.x * dt;
		this.pos.z += this.vel.z * dt;
		this.resolveWalls();

		// start climbing: airborne/swimming, pushing into a climbable wall
		if ( ! this.climbing && this.wall && ! this.grounded && this.climbLock <= 0 && this.stamina > 0.02 && intentLen > 0.3 ) {

			const into = - ( _wish.x * this.wallN.x + _wish.z * this.wallN.z );
			if ( into > 0.45 && this.wall.climbable ) {

				this.climbing = true;
				this.jumps = 1;
				this.events.push( 'grab' );

			}

		}

		// vertical
		this.pos.y += this.vel.y * dt;
		const g = this.physics.groundAt( this.pos.x, this.pos.z, this.pos.y, STEP, _list );
		const wasGrounded = this.grounded;
		if ( this.pos.y <= g + 0.001 && this.vel.y <= 0.01 ) {

			if ( ! wasGrounded && this.vel.y < - 3 ) {

				this.landed = - this.vel.y;
				this.events.push( 'land' );

			}

			this.pos.y = g;
			this.vel.y = 0;
			this.grounded = true;
			this.jumps = 1;
			if ( this.climbing ) this.climbing = false;

		} else if ( wasGrounded && this.vel.y <= 0 && this.pos.y - g < 0.38 && ! this.swimming ) {

			this.pos.y = g; // stick to stairs and roof slopes
			this.vel.y = 0;

		} else {

			if ( wasGrounded ) this.coyote = 0.12;
			this.grounded = false;

		}

		if ( this.grounded ) this.stamina = Math.min( 1, this.stamina + dt * 0.55 );

	}

	climbStep( dt, intentLen, run ) {

		const n = this.wallN;
		const into = - ( _wish.x * n.x + _wish.z * n.z ) * intentLen;
		const tx = n.z, tz = - n.x;
		const lateral = ( _wish.x * tx + _wish.z * tz ) * intentLen;
		this.yaw = Math.atan2( - n.x, - n.z );

		if ( this.jumpBuffer > 0 ) {

			// wall jump
			this.climbing = false;
			this.jumpBuffer = 0;
			this.climbLock = 0.4;
			this.vel.set( n.x * 5.5, 7.6, n.z * 5.5 );
			this.yaw = Math.atan2( n.x, n.z );
			this.flip = 0;
			this.events.push( 'walljump' );
			return;

		}

		if ( into < - 0.3 || ! this.wall ) {

			this.climbing = false;
			this.climbLock = 0.3;
			this.vel.set( n.x * 1.5, 0, n.z * 1.5 );
			return;

		}

		let vy;
		if ( this.stamina <= 0 ) {

			vy = - 2.2;

		} else if ( into > 0.3 ) {

			vy = CLIMB_V * ( run ? 1.25 : 1 );
			this.stamina -= dt / CLIMB_TIME * ( run ? 1.6 : 1 );

		} else {

			vy = 0;
			this.stamina -= dt / CLIMB_TIME * 0.35;

		}

		this.stamina = Math.max( 0, this.stamina );
		this.vel.set( - n.x * 1.2 + tx * lateral * 1.6, vy, - n.z * 1.2 + tz * lateral * 1.6 );

	}

	resolveWalls() {

		const p = this.pos;
		const r = RADIUS;
		const list = this.physics.query( p.x - r - 0.5, p.z - r - 0.5, p.x + r + 0.5, p.z + r + 0.5, _list );
		const prevWall = this.wall;
		this.wall = null;
		let bestDepth = 0;
		for ( let iter = 0; iter < 2; iter ++ ) {

			for ( const c of list ) {

				if ( p.y >= c.maxY - STEP ) continue;
				if ( p.y + HEIGHT <= c.minY ) continue;
				const qx = Math.max( c.minX, Math.min( p.x, c.maxX ) );
				const qz = Math.max( c.minZ, Math.min( p.z, c.maxZ ) );
				let dx = p.x - qx, dz = p.z - qz;
				let d2 = dx * dx + dz * dz;
				if ( d2 >= r * r ) continue;
				let nx, nz, depth;
				if ( d2 > 1e-8 ) {

					const d = Math.sqrt( d2 );
					nx = dx / d;
					nz = dz / d;
					depth = r - d;

				} else {

					// centre inside the box: push out along the shallowest axis
					const l = p.x - c.minX, rr = c.maxX - p.x, b = p.z - c.minZ, f = c.maxZ - p.z;
					const m = Math.min( l, rr, b, f );
					nx = m === l ? - 1 : m === rr ? 1 : 0;
					nz = m === b ? - 1 : m === f ? 1 : 0;
					if ( nx !== 0 ) nz = 0;
					depth = m + r;

				}

				p.x += nx * depth;
				p.z += nz * depth;
				const vn = this.vel.x * nx + this.vel.z * nz;
				if ( vn < 0 ) {

					this.vel.x -= vn * nx;
					this.vel.z -= vn * nz;

				}

				if ( depth > bestDepth || ( c === prevWall && ! this.wall ) ) {

					// prefer axis-aligned normals for clean climbing
					if ( Math.abs( nx ) > Math.abs( nz ) ) this.wallN.set( Math.sign( nx ), 0, 0 );
					else this.wallN.set( 0, 0, Math.sign( nz ) );
					this.wall = c;
					bestDepth = depth;

				}

				dx = dz = d2 = 0;

			}

		}

		// reached the top of the wall while climbing → mantle onto it
		if ( this.climbing && ! this.wall && prevWall ) {

			this.climbing = false;
			if ( p.y >= prevWall.maxY - STEP - 0.1 ) {

				this.vel.set( - this.wallN.x * 2.6, 4.6, - this.wallN.z * 2.6 );
				this.events.push( 'mantle' );

			}

		}

	}

	get height() {

		return HEIGHT;

	}

}
