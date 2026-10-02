import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng } from '../core/rng.js';
import { PROMENADE, RIVER_E, AVENUE, PLAZA, QUAY_ROAD, SPIRE, BASILICA } from './layout.js';

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const v = new THREE.Vector3();
const s = new THREE.Vector3();

function treeGeometries( rng ) {

	const trunk = new THREE.CylinderGeometry( 0.16, 0.26, 3.4, 7 );
	trunk.translate( 0, 1.7, 0 );

	const blobs = [];
	const n = 6;
	for ( let i = 0; i < n; i ++ ) {

		const g = new THREE.IcosahedronGeometry( rng.range( 1.5, 2.2 ), 2 );
		const a = i / n * Math.PI * 2;
		const rad = i === 0 ? 0 : rng.range( 1.0, 1.6 );
		g.translate( Math.cos( a ) * rad, 4.6 + rng.range( - 0.6, 1.1 ) + ( i === 0 ? 1.1 : 0 ), Math.sin( a ) * rad );
		blobs.push( g );

	}

	const foliage = mergeGeometries( blobs );
	const p = foliage.attributes.position;
	const colors = new Float32Array( p.count * 3 );
	for ( let i = 0; i < p.count; i ++ ) {

		v.fromBufferAttribute( p, i );
		const nz = Math.sin( v.x * 2.1 + v.y * 1.3 ) * Math.cos( v.z * 1.7 - v.y ) * 0.28;
		const len = Math.hypot( v.x, v.z );
		v.x *= 1 + nz / Math.max( 1, len );
		v.z *= 1 + nz / Math.max( 1, len );
		v.y += nz * 0.6;
		p.setXYZ( i, v.x, v.y, v.z );
		const t = THREE.MathUtils.clamp( ( v.y - 3 ) / 4.5, 0, 1 );
		colors[ i * 3 ] = 0.55 + t * 0.45;
		colors[ i * 3 + 1 ] = 0.62 + t * 0.38;
		colors[ i * 3 + 2 ] = 0.5 + t * 0.35;

	}

	foliage.setAttribute( 'color', new THREE.BufferAttribute( colors, 3 ) );
	foliage.computeVertexNormals();
	return { trunk, foliage };

}

export function buildProps( scene, physics, city, groundApi ) {

	const rng = createRng( 4242 );
	const group = new THREE.Group();
	group.name = 'props';
	scene.add( group );

	// ---------------- trees ----------------
	const trees = [];
	const addTree = ( x, z, scale = 1, collide = true ) => {

		trees.push( [ x, z, scale ] );
		if ( collide ) physics.add( x - 0.25, 0, z - 0.25, x + 0.25, 3.2, z + 0.25, null, { climbable: false } );

	};

	const avoidAvenue = ( z ) => z > AVENUE.z0 - 4 && z < AVENUE.z1 + 4;
	for ( let z = - 900; z < 900; z += 9 ) {

		if ( avoidAvenue( z ) ) continue;
		addTree( PROMENADE.x0 + 6, z + rng.range( - 0.5, 0.5 ), rng.range( 0.9, 1.15 ) );
		addTree( PROMENADE.x0 + 16, z + 4.5 + rng.range( - 0.5, 0.5 ), rng.range( 0.9, 1.15 ) );
		addTree( RIVER_E + 12, z + rng.range( - 0.5, 0.5 ), rng.range( 0.9, 1.15 ) );
		addTree( RIVER_E + 22, z + 4.5, rng.range( 0.9, 1.15 ) );

	}

	// plaza: double row on the south and west edges
	for ( let x = PLAZA.x0 + 6; x < BASILICA.x0 - 6; x += 8 ) {

		addTree( x, PLAZA.z1 - 6, rng.range( 0.85, 1.05 ) );

	}

	for ( let z = PLAZA.z0 + 8; z < PLAZA.z1 - 12; z += 8 ) addTree( PLAZA.x0 + 6, z, rng.range( 0.85, 1.05 ) );

	// parks
	const grassMat = groundApi.grass;
	for ( const p of city.parks ) {

		groundApi.plane( p.x0, p.x1, p.z0, p.z1, grassMat, 0.012 );
		const n = Math.floor( ( p.x1 - p.x0 ) * ( p.z1 - p.z0 ) / 140 );
		for ( let i = 0; i < n; i ++ ) addTree( rng.range( p.x0 + 3, p.x1 - 3 ), rng.range( p.z0 + 3, p.z1 - 3 ), rng.range( 0.8, 1.4 ), false );

	}

	{

		const { trunk, foliage } = treeGeometries( rng );
		const trunkMesh = new THREE.InstancedMesh( trunk, new THREE.MeshStandardMaterial( { color: 0x6b5a4a, roughness: 1 } ), trees.length );
		const leafMesh = new THREE.InstancedMesh( foliage, new THREE.MeshStandardMaterial( { vertexColors: true, roughness: 0.85 } ), trees.length );
		const col = new THREE.Color();
		trees.forEach( ( [ x, z, sc ], i ) => {

			q.setFromAxisAngle( v.set( 0, 1, 0 ), rng.range( 0, Math.PI * 2 ) );
			m4.compose( v.set( x, 0, z ), q, s.set( sc, sc * rng.range( 0.9, 1.1 ), sc ) );
			trunkMesh.setMatrixAt( i, m4 );
			leafMesh.setMatrixAt( i, m4 );
			col.setHSL( rng.range( 0.2, 0.28 ), rng.range( 0.35, 0.5 ), rng.range( 0.26, 0.36 ) );
			leafMesh.setColorAt( i, col );

		} );
		for ( const m of [ trunkMesh, leafMesh ] ) {

			m.castShadow = true;
			m.receiveShadow = true;
			m.computeBoundingSphere();
			group.add( m );

		}

	}

	// ---------------- parked cars ----------------
	{

		const body = new THREE.BoxGeometry( 1.8, 0.75, 4.3 );
		body.translate( 0, 0.65, 0 );
		const cabin = new THREE.BoxGeometry( 1.6, 0.6, 2.3 );
		cabin.translate( 0, 1.3, - 0.2 );
		const carGeo = mergeGeometries( [ body, cabin ] );
		const glassGeo = new THREE.BoxGeometry( 1.62, 0.45, 2.1 );
		glassGeo.translate( 0, 1.32, - 0.2 );
		const wheel = new THREE.CylinderGeometry( 0.33, 0.33, 0.25, 12 );
		wheel.rotateZ( Math.PI / 2 );
		const wheels = [];
		for ( const wx of [ - 0.82, 0.82 ] ) for ( const wz of [ - 1.35, 1.35 ] ) wheels.push( wheel.clone().translate( wx, 0.33, wz ) );
		const wheelGeo = mergeGeometries( wheels );

		const spots = [];
		for ( let z = - 600; z < 600; z += rng.range( 5, 14 ) ) {

			if ( avoidAvenue( z ) ) continue;
			if ( rng.chance( 0.7 ) ) spots.push( [ QUAY_ROAD.x0 + 1.4, z, 0 ] );
			if ( rng.chance( 0.5 ) ) spots.push( [ QUAY_ROAD.x1 - 1.4, z + 3, Math.PI ] );

		}

		// a few parked on the plaza like in the aerial photo
		for ( let i = 0; i < 9; i ++ ) spots.push( [ SPIRE.x - 30 + i * 2.6, PLAZA.z0 + 10, Math.PI / 2 ] );

		const paint = [ 0xf2f2f2, 0xe8e8e8, 0x2a2a2a, 0x9aa3ab, 0x4b5e78, 0x8a1f24, 0xd9d4c7, 0x3d4a3a ];
		const carMat = new THREE.MeshStandardMaterial( { roughness: 0.3, metalness: 0.4 } );
		const cars = new THREE.InstancedMesh( carGeo, carMat, spots.length );
		const glass = new THREE.InstancedMesh( glassGeo, new THREE.MeshStandardMaterial( { color: 0x1a2229, roughness: 0.05, metalness: 0.6 } ), spots.length );
		const wh = new THREE.InstancedMesh( wheelGeo, new THREE.MeshStandardMaterial( { color: 0x151515, roughness: 0.8 } ), spots.length );
		const col = new THREE.Color();
		spots.forEach( ( [ x, z, rot ], i ) => {

			q.setFromAxisAngle( v.set( 0, 1, 0 ), rot );
			m4.compose( v.set( x, 0, z ), q, s.set( 1, 1, 1 ) );
			cars.setMatrixAt( i, m4 );
			glass.setMatrixAt( i, m4 );
			wh.setMatrixAt( i, m4 );
			cars.setColorAt( i, col.set( rng.pick( paint ) ) );
			const along = Math.abs( Math.sin( rot ) ) > 0.5;
			const hx = along ? 2.15 : 0.9, hz = along ? 0.9 : 2.15;
			physics.add( x - hx, 0, z - hz, x + hx, 1.6, z + hz, null, { climbable: true } );

		} );
		for ( const m of [ cars, glass, wh ] ) {

			m.castShadow = true;
			m.receiveShadow = true;
			m.computeBoundingSphere();
			group.add( m );

		}

	}

	// ---------------- street lamps around the plaza ----------------
	{

		const post = new THREE.CylinderGeometry( 0.06, 0.1, 4.2, 6 );
		post.translate( 0, 2.1, 0 );
		const lantern = new THREE.CylinderGeometry( 0.22, 0.12, 0.5, 6 );
		lantern.translate( 0, 4.45, 0 );
		const pts = [];
		for ( let x = PLAZA.x0 + 10; x < PLAZA.x1 - 10; x += 16 ) pts.push( [ x, PLAZA.z0 + 4 ] );
		for ( let z = PLAZA.z0 + 12; z < PLAZA.z1 - 6; z += 16 ) pts.push( [ PLAZA.x0 + 3, z ] );
		const posts = new THREE.InstancedMesh( post, new THREE.MeshStandardMaterial( { color: 0x222426, roughness: 0.5, metalness: 0.6 } ), pts.length );
		const lamps = new THREE.InstancedMesh( lantern, new THREE.MeshStandardMaterial( { color: 0xfff3d6, emissive: 0xffe2a8, emissiveIntensity: 0.5 } ), pts.length );
		pts.forEach( ( [ x, z ], i ) => {

			m4.makeTranslation( x, 0, z );
			posts.setMatrixAt( i, m4 );
			lamps.setMatrixAt( i, m4 );
			physics.add( x - 0.1, 0, z - 0.1, x + 0.1, 4.2, z + 0.1, null, { climbable: false } );

		} );
		posts.castShadow = true;
		group.add( posts, lamps );

	}

	const pigeons = new Pigeons( group, rng );
	return { group, pigeons };

}

// A flock of plaza pigeons that peck around and burst into flight when the cat gets close.
class Pigeons {

	constructor( parent, rng ) {

		this.rng = rng;
		this.count = 48;
		const body = new THREE.SphereGeometry( 1, 10, 8 );
		body.scale( 0.09, 0.09, 0.16 );
		body.translate( 0, 0.12, 0 );
		const head = new THREE.SphereGeometry( 0.055, 8, 6 );
		head.translate( 0, 0.22, 0.12 );
		const tail = new THREE.ConeGeometry( 0.06, 0.14, 4 );
		tail.rotateX( - Math.PI / 2 - 0.3 );
		tail.scale( 1, 0.4, 1 );
		tail.translate( 0, 0.13, - 0.2 );
		const beak = new THREE.ConeGeometry( 0.015, 0.05, 4 );
		beak.rotateX( Math.PI / 2 );
		beak.translate( 0, 0.21, 0.19 );
		const geo = mergeGeometries( [ body, head, tail, beak ] );
		const mat = new THREE.MeshStandardMaterial( { color: 0x8c8f99, roughness: 0.8 } );
		this.bodies = new THREE.InstancedMesh( geo, mat, this.count );
		const wing = new THREE.BufferGeometry();
		wing.setAttribute( 'position', new THREE.Float32BufferAttribute( [ 0, 0, 0.08, 0.32, 0, - 0.02, 0, 0, - 0.12 ], 3 ) );
		wing.computeVertexNormals();
		const wingMat = new THREE.MeshStandardMaterial( { color: 0x6f727c, side: THREE.DoubleSide, roughness: 0.8 } );
		this.wings = new THREE.InstancedMesh( wing, wingMat, this.count * 2 );
		const col = new THREE.Color();
		this.birds = [];
		for ( let i = 0; i < this.count; i ++ ) {

			const b = {
				pos: new THREE.Vector3( rng.range( PLAZA.x0 + 8, BASILICA.x0 - 4 ), 0, rng.range( PLAZA.z0 + 14, PLAZA.z1 - 10 ) ),
				vel: new THREE.Vector3(),
				yaw: rng.range( 0, Math.PI * 2 ),
				state: 'ground',
				timer: rng.range( 0, 3 ),
				flap: rng.range( 0, 10 ),
				peck: 0,
				home: null,
			};
			b.home = b.pos.clone();
			this.birds.push( b );
			const g = rng.range( 0.45, 0.75 );
			this.bodies.setColorAt( i, col.setRGB( g, g * 1.02, g * 1.1 ) );

		}

		this.bodies.castShadow = true;
		this.bodies.frustumCulled = false;
		this.wings.frustumCulled = false;
		parent.add( this.bodies, this.wings );

	}

	update( dt, playerPos, playerSpeed, onScare ) {

		const rng = this.rng;
		let scared = 0;
		for ( let i = 0; i < this.count; i ++ ) {

			const b = this.birds[ i ];
			const dx = b.pos.x - playerPos.x, dz = b.pos.z - playerPos.z;
			const dist = Math.hypot( dx, dz );
			if ( b.state === 'ground' ) {

				b.timer -= dt;
				b.peck = Math.max( 0, b.peck - dt * 4 );
				if ( b.timer < 0 ) {

					b.timer = rng.range( 0.5, 2.5 );
					if ( rng.chance( 0.5 ) ) b.peck = 1;
					else {

						b.yaw += rng.range( - 1.5, 1.5 );
						b.vel.set( Math.sin( b.yaw ), 0, Math.cos( b.yaw ) ).multiplyScalar( rng.range( 0.3, 0.7 ) );

					}

				}

				b.vel.multiplyScalar( 1 - dt * 2 );
				b.pos.addScaledVector( b.vel, dt );
				// wander back towards home
				b.pos.x += ( b.home.x - b.pos.x ) * dt * 0.02;
				b.pos.z += ( b.home.z - b.pos.z ) * dt * 0.02;
				const fear = 2.2 + playerSpeed * 0.6;
				if ( dist < fear && Math.abs( playerPos.y - b.pos.y ) < 3 ) {

					b.state = 'fly';
					b.timer = rng.range( 4, 8 );
					const ax = dist > 0.01 ? dx / dist : 1, az = dist > 0.01 ? dz / dist : 0;
					b.vel.set( ax * rng.range( 4, 7 ) + rng.range( - 2, 2 ), rng.range( 4, 6.5 ), az * rng.range( 4, 7 ) + rng.range( - 2, 2 ) );
					scared ++;

				}

			} else if ( b.state === 'fly' ) {

				b.timer -= dt;
				b.flap += dt * 28;
				// circle up and around the spire
				const cx = SPIRE.x - b.pos.x, cz = SPIRE.z - b.pos.z;
				const cl = Math.hypot( cx, cz ) || 1;
				b.vel.x += ( - cz / cl * 6 - b.vel.x ) * dt * 0.6 + cx / cl * dt * 1.5;
				b.vel.z += ( cx / cl * 6 - b.vel.z ) * dt * 0.6 + cz / cl * dt * 1.5;
				b.vel.y += ( ( b.timer > 0 ? 18 : 0 ) - b.pos.y ) * dt * 0.4 - b.vel.y * dt * 0.6;
				b.pos.addScaledVector( b.vel, dt );
				b.yaw = Math.atan2( b.vel.x, b.vel.z );
				if ( b.timer <= 0 ) {

					// glide back down to a fresh spot
					b.state = 'land';
					b.home.set( rng.range( PLAZA.x0 + 8, BASILICA.x0 - 4 ), 0, rng.range( PLAZA.z0 + 14, PLAZA.z1 - 10 ) );

				}

			} else {

				b.flap += dt * 16;
				const tx = b.home.x - b.pos.x, ty = b.home.y - b.pos.y, tz = b.home.z - b.pos.z;
				const l = Math.hypot( tx, ty, tz );
				const sp = Math.min( 7, l * 1.2 + 1 );
				b.vel.set( tx / l * sp, ty / l * sp, tz / l * sp );
				b.pos.addScaledVector( b.vel, dt );
				b.yaw = Math.atan2( b.vel.x, b.vel.z );
				if ( l < 0.3 ) {

					b.pos.copy( b.home );
					b.vel.set( 0, 0, 0 );
					b.state = 'ground';
					b.timer = rng.range( 1, 3 );

				}

			}

			const airborne = b.state !== 'ground';
			q.setFromAxisAngle( v.set( 0, 1, 0 ), b.yaw );
			const pitch = new THREE.Quaternion().setFromAxisAngle( v.set( 1, 0, 0 ), b.peck * 0.6 - ( airborne ? 0.1 : 0 ) );
			q.multiply( pitch );
			m4.compose( b.pos, q, s.set( 1, 1, 1 ) );
			this.bodies.setMatrixAt( i, m4 );
			const flapA = airborne ? Math.sin( b.flap ) * 0.9 : - 1.35;
			for ( let w = 0; w < 2; w ++ ) {

				const side = w === 0 ? 1 : - 1;
				const wq = new THREE.Quaternion().setFromAxisAngle( v.set( 0, 0, 1 ), side * flapA );
				const sc = new THREE.Vector3( side, 1, 1 );
				const off = new THREE.Vector3( side * 0.06, 0.16, 0 ).applyQuaternion( q );
				const local = new THREE.Matrix4().compose( new THREE.Vector3(), wq, sc );
				m4.compose( v.copy( b.pos ).add( off ), q, s.set( 1, 1, 1 ) ).multiply( local );
				this.wings.setMatrixAt( i * 2 + w, m4 );

			}

		}

		this.bodies.instanceMatrix.needsUpdate = true;
		this.wings.instanceMatrix.needsUpdate = true;
		if ( scared && onScare ) onScare( scared );

	}

}
