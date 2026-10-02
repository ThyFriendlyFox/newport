import * as THREE from 'three/webgpu';

const _list = [];

// Third-person orbit camera with smoothing and collision against the city.
export class ThirdPersonCamera {

	constructor( camera, physics ) {

		this.camera = camera;
		this.physics = physics;
		this.yaw = 0;
		this.pitch = 0.22;
		this.distance = 5.2;
		this.targetDistance = 5.2;
		this.current = 5.2;
		this.focus = new THREE.Vector3();
		this.sensitivity = 0.0024;
		this.autoAlign = 0;

	}

	snap( target, yaw ) {

		this.yaw = yaw + Math.PI;
		this.focus.copy( target );

	}

	update( dt, target, input, playerYaw, moving ) {

		const lx = input.look.x, ly = input.look.y;
		this.yaw -= lx * this.sensitivity;
		this.pitch = THREE.MathUtils.clamp( this.pitch + ly * this.sensitivity, - 0.65, 1.35 );
		if ( input.zoom ) this.targetDistance = THREE.MathUtils.clamp( this.targetDistance * ( 1 + input.zoom * 0.12 ), 1.8, 22 );

		// gentle auto-follow behind the player when moving and the mouse is idle (touch especially)
		if ( Math.abs( lx ) + Math.abs( ly ) > 0 ) this.autoAlign = 1.2;
		this.autoAlign -= dt;
		if ( moving && this.autoAlign < 0 && input.isTouch ) {

			let d = ( playerYaw + Math.PI ) - this.yaw;
			d = Math.atan2( Math.sin( d ), Math.cos( d ) );
			this.yaw += d * Math.min( 1, dt * 1.2 );

		}

		// smooth focus — tighter vertically to avoid lag on jumps
		const kx = 1 - Math.exp( - dt * 16 ), ky = 1 - Math.exp( - dt * 9 );
		this.focus.x += ( target.x - this.focus.x ) * kx;
		this.focus.z += ( target.z - this.focus.z ) * kx;
		this.focus.y += ( target.y - this.focus.y ) * ky;

		const cp = Math.cos( this.pitch ), sp = Math.sin( this.pitch );
		const dir = new THREE.Vector3( Math.sin( this.yaw ) * cp, sp, Math.cos( this.yaw ) * cp );

		// collision: march from focus outwards
		let allowed = this.targetDistance;
		const stepLen = 0.2;
		for ( let s = 0.4; s <= this.targetDistance; s += stepLen ) {

			const x = this.focus.x + dir.x * s, y = this.focus.y + dir.y * s, z = this.focus.z + dir.z * s;
			if ( this.physics.solidAt( x, y, z, _list ) ) {

				allowed = Math.max( 0.6, s - 0.35 );
				break;

			}

		}

		// pull in fast, ease out slowly
		this.current = allowed < this.current ? allowed : this.current + ( allowed - this.current ) * Math.min( 1, dt * 3 );
		const cam = this.camera;
		cam.position.copy( this.focus ).addScaledVector( dir, this.current );
		// keep above water/ground a little
		cam.position.y = Math.max( cam.position.y, - 4.6 );
		cam.lookAt( this.focus );

	}

}
