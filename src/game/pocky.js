import * as THREE from 'three/webgpu';
import { createRng } from '../core/rng.js';
import { makePockyLabel } from '../world/textures.js';
import { SPIRE, PLAZA, BRIDGE, RIVER_W, RIVER_E, WATER_Y, BASILICA, PROMENADE, SPAWN } from '../world/layout.js';

const _list = [];

// Pocky boxes hidden around the city: streets, rooftops, the bridge, the river — and a golden one atop the spire.
export class PockyHunt {

	constructor( scene, physics, city ) {

		this.group = new THREE.Group();
		this.group.name = 'pocky';
		scene.add( this.group );
		this.items = [];
		this.collected = 0;

		const label = makePockyLabel();
		const red = new THREE.MeshStandardMaterial( { color: 0xd8162a, roughness: 0.35, emissive: 0x400008 } );
		const face = new THREE.MeshStandardMaterial( { map: label, roughness: 0.35, emissive: 0xffffff, emissiveMap: label, emissiveIntensity: 0.18 } );
		const goldFace = new THREE.MeshStandardMaterial( { map: label, color: 0xffd36b, metalness: 0.8, roughness: 0.25, emissive: 0xffb520, emissiveMap: label, emissiveIntensity: 0.5 } );
		const gold = new THREE.MeshStandardMaterial( { color: 0xffc94a, metalness: 0.9, roughness: 0.2, emissive: 0x6a4300 } );
		this.boxGeo = new THREE.BoxGeometry( 0.32, 0.48, 0.09 );
		this.mats = [ red, red, red, red, face, face ];
		this.goldMats = [ gold, gold, gold, gold, goldFace, goldFace ];
		this.beamMat = new THREE.MeshBasicMaterial( { color: 0xff6b8a, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide } );
		this.goldBeamMat = this.beamMat.clone();
		this.goldBeamMat.color.set( 0xffcf5a );
		this.goldBeamMat.opacity = 0.22;
		const beam = new THREE.CylinderGeometry( 0.12, 0.45, 26, 10, 1, true );
		beam.translate( 0, 13, 0 );
		this.beamGeo = beam;
		this.haloGeo = new THREE.RingGeometry( 0.36, 0.5, 32 );
		this.haloMat = new THREE.MeshBasicMaterial( { color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide } );

		const rng = createRng( 777 );
		const spots = [];
		// plaza
		spots.push( [ - 40, 1, - 30 ], [ 20, 1, 38 ], [ BASILICA.x0 - 6, 1, - 30 ], [ - 10, 1, 8 ] );
		// spire ledges and top
		spots.push( [ SPIRE.x + 6.2, 27.4, SPIRE.z ], [ SPIRE.x - 4.8, 47.3, SPIRE.z + 1 ], [ SPIRE.x, 77, SPIRE.z - 2.3 ] );
		// basilica roofs
		spots.push( [ 72, 36.8, 0 ], [ BASILICA.x0 + 10, 14.4, BASILICA.z1 - 4 ] );
		// bridge, river, quays
		spots.push( [ ( RIVER_W + RIVER_E ) / 2, BRIDGE.deckY + 1, BRIDGE.z ] );
		spots.push( [ RIVER_W + 60, WATER_Y + 0.6, BRIDGE.z + 40 ] );
		spots.push( [ PROMENADE.x0 + 11, 1, 60 ], [ PROMENADE.x0 + 11, 1, - 320 ], [ RIVER_E + 17, 1, BRIDGE.z - 30 ] );
		// rooftops near the start
		const roofs = city.roofSpots.filter( ( r ) => Math.hypot( r.x - SPAWN.x, r.z - SPAWN.z ) < 260 && r.y < 22 );
		for ( let i = 0; i < 10 && roofs.length; i ++ ) {

			const r = roofs.splice( Math.floor( rng.next() * roofs.length ), 1 )[ 0 ];
			spots.push( [ r.x, r.y + 0.7, r.z ] );

		}

		// street level
		let guard = 0;
		while ( spots.length < 29 && guard ++ < 500 ) {

			const x = rng.range( - 320, 180 ), z = rng.range( - 320, 280 );
			if ( x > PLAZA.x0 && x < PLAZA.x1 && z > PLAZA.z0 && z < PLAZA.z1 ) continue;
			if ( physics.solidAt( x, 0.5, z, _list ) || physics.solidAt( x + 1, 0.5, z, _list ) || physics.solidAt( x - 1, 0.5, z, _list ) ) continue;
			spots.push( [ x, 1, z ] );

		}

		for ( const [ x, y, z ] of spots ) {

			const ground = physics.groundAt( x, z, y + 0.5, 1.5 );
			const yy = y === 1 ? ground + 1 : y; // y === 1 marks a ground-relative spot
			this.add( x, yy, z, false );

		}

		// the golden one
		this.add( SPIRE.x, 109.6, SPIRE.z, true );
		this.total = this.items.length;

	}

	add( x, y, z, golden ) {

		const g = new THREE.Group();
		g.position.set( x, y, z );
		const box = new THREE.Mesh( this.boxGeo, golden ? this.goldMats : this.mats );
		box.castShadow = true;
		g.add( box );
		const halo = new THREE.Mesh( this.haloGeo, this.haloMat );
		g.add( halo );
		const beam = new THREE.Mesh( this.beamGeo, golden ? this.goldBeamMat : this.beamMat );
		beam.position.y = - 0.4;
		beam.renderOrder = 5;
		g.add( beam );
		if ( golden ) g.scale.setScalar( 2 );
		this.group.add( g );
		this.items.push( { group: g, box, halo, beam, golden, taken: false, base: y, phase: Math.random() * 6, pop: 0 } );

	}

	nearest( pos ) {

		let best = null, bd = Infinity;
		for ( const it of this.items ) {

			if ( it.taken ) continue;
			const d = it.group.position.distanceTo( pos );
			if ( d < bd ) {

				bd = d;
				best = it;

			}

		}

		return best ? { item: best, dist: bd } : null;

	}

	update( dt, playerCenter, camera, onCollect ) {

		const t = performance.now() / 1000;
		for ( const it of this.items ) {

			if ( it.taken ) {

				if ( it.pop > 0 ) {

					it.pop -= dt * 2.5;
					const s = ( it.golden ? 2 : 1 ) * ( 1 + ( 1 - it.pop ) * 1.5 );
					it.group.scale.setScalar( s );
					it.group.position.y += dt * 3;
					it.box.rotation.y += dt * 20;
					it.halo.material.opacity = Math.max( 0, it.pop ) * 0.6;
					if ( it.pop <= 0 ) it.group.visible = false;

				}

				continue;

			}

			it.box.rotation.y = t * 1.6 + it.phase;
			it.box.position.y = Math.sin( t * 2 + it.phase ) * 0.12;
			it.halo.position.y = it.box.position.y;
			it.halo.quaternion.copy( camera.quaternion );
			const d = it.group.position.distanceTo( playerCenter );
			// beams fade when close so they don't block the view
			it.beam.visible = d > 6;
			if ( d < ( it.golden ? 2.6 : 1.25 ) ) {

				it.taken = true;
				it.pop = 1;
				it.beam.visible = false;
				it.halo.material = it.halo.material.clone();
				this.collected ++;
				onCollect( it );

			}

		}

	}

}
