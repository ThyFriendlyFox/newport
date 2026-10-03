import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, screenUV, vec3, vec4, float, mix, uv, smoothstep, length, builtinAOContext } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';

import { Physics } from './core/physics.js';
import { Input } from './core/input.js';
import { createRng } from './core/rng.js';
import { createTextures } from './world/textures.js';
import { buildCity } from './world/city.js';
import { buildLandmarks } from './world/landmarks.js';
import { buildSky, buildLights, buildGround, buildWater, updateSun } from './world/environment.js';
import { buildProps } from './world/props.js';
import { SPAWN, SPIRE } from './world/layout.js';
import { createCharacterAtlas } from './characters/atlas.js';
import { loadGlbKid } from './characters/glbkid.js';
import { Animator, KID_STYLE } from './characters/animator.js';
import { PlayerController } from './player/controller.js';
import { ThirdPersonCamera } from './player/camera.js';
import { PockyHunt } from './game/pocky.js';
import { ZombieManager } from './game/zombies.js';
import { Sfx } from './game/audio.js';
import { Hud } from './ui/hud.js';

const params = new URLSearchParams( location.search );
const LOW = params.has( 'low' );
const FORCE_WEBGL = params.has( 'webgl' );
const NO_AO = LOW || params.has( 'noao' );
const NO_BLOOM = LOW || params.has( 'nobloom' );

const $ = ( id ) => document.getElementById( id );
const frame = () => new Promise( ( r ) => requestAnimationFrame( () => setTimeout( r, 0 ) ) );

async function progress( p, label ) {

	$( 'progress-fill' ).style.width = ( p * 100 ).toFixed( 0 ) + '%';
	$( 'play-label' ).textContent = label;
	await frame();

}

async function boot() {

	$( 'overlay' ).classList.add( 'loading' );
	await progress( 0.04, 'Starting the renderer…' );

	const renderer = new THREE.WebGPURenderer( { antialias: false, powerPreference: 'high-performance', forceWebGL: FORCE_WEBGL } );
	renderer.setPixelRatio( Math.min( devicePixelRatio, LOW ? 1 : 1.75 ) );
	renderer.setSize( innerWidth, innerHeight );
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 0.66;
	renderer.shadowMap.enabled = true;
	$( 'app' ).appendChild( renderer.domElement );
	await renderer.init();
	const isWebGPU = !! renderer.backend.isWebGPUBackend;
	if ( ! isWebGPU ) {

		$( 'foot' ).textContent = 'WebGPU isn’t available in this browser — running on the WebGL 2 fallback.';
		$( 'foot' ).classList.add( 'warn' );

	}

	const scene = new THREE.Scene();
	scene.fog = new THREE.Fog( 0xc3d3e1, 260, 1650 );
	const camera = new THREE.PerspectiveCamera( 55, innerWidth / innerHeight, 0.1, 12000 );

	await progress( 0.1, 'Painting limestone and terracotta…' );
	const tex = createTextures();

	await progress( 0.25, 'Laying out the streets…' );
	const physics = new Physics( 16 );
	const rng = createRng( 1871 );
	const city = buildCity( scene, physics, tex, rng );

	await progress( 0.45, 'Raising the Flèche Saint-Michel…' );
	buildLandmarks( scene, physics, tex );
	buildSky( scene );
	const { sun } = buildLights( scene );
	const ground = buildGround( scene, tex );
	buildWater( scene );

	await progress( 0.55, 'Planting plane trees and pigeons…' );
	const props = buildProps( scene, physics, city, ground );

	await progress( 0.62, 'Hiding the Pocky…' );
	const hunt = new PockyHunt( scene, physics, city );

	await progress( 0.68, 'Rigging the cat kid…' );
	const atlas = createCharacterAtlas();
	// the retopologised kid (tools/retopo/build.py)
	const kid = await loadGlbKid( '/models/catkid.glb' );
	const sculpt = kid;
	scene.add( kid.root );
	const spawnYaw = Math.atan2( SPIRE.x - SPAWN.x, SPIRE.z - SPAWN.z );
	const player = new PlayerController( physics, { ...SPAWN, yaw: spawnYaw } );
	const kidStyle = { ...KID_STYLE, hipHeight: sculpt.hipHeight, stance: Math.abs( sculpt.J.hipL.x - sculpt.J.hipR.x ) / 2 + 0.01, strideMin: 0.5, strideK: 0.12, strideMax: 1.5 };
	const animator = new Animator( kid, { scale: 1, tail: { segments: 9, segLen: 0.08, radius: 0.05, lift: 0.3 } }, kidStyle, physics, true );
	// the animator works in the sculpt's own (taller) space; the root is scaled to 1.62 m, so
	// ground probes need the inverse scale
	kid.root.scale.setScalar( 1.62 / 1.80 ); // sculpt is modelled at 1.8 m
	animator.groundScale = 1 / kid.root.scale.x;

	await progress( 0.74, 'Waking the dead…' );
	const zombies = new ZombieManager( scene, physics, atlas, city );

	const input = new Input( renderer.domElement );
	const cam = new ThirdPersonCamera( camera, physics );
	const sfx = new Sfx();
	const hud = new Hud( hunt.total, isWebGPU );

	await progress( 0.8, 'Lighting the sky…' );
	const envScene = new THREE.Scene();
	const envSky = buildSky( envScene );
	envSky.cloudCoverage.value = 0.0;
	const pmrem = new THREE.PMREMGenerator( renderer );
	scene.environment = pmrem.fromScene( envScene, 0, 1, 20000 ).texture;
	scene.environmentIntensity = 0.55;

	// ---- post-processing: MSAA scene pass, GTAO, bloom, vignette & grade -------------------
	const pipeline = new THREE.RenderPipeline( renderer );
	const scenePass = pass( scene, camera, { samples: LOW ? 0 : 4 } );
	if ( ! NO_AO ) {

		scenePass.setMRT( mrt( { output, normal: normalView } ) );
		const aoPass = ao( scenePass.getTextureNode( 'depth' ), scenePass.getTextureNode( 'normal' ), camera );
		aoPass.radius.value = 1.2;
		aoPass.distanceExponent.value = 1.2;
		aoPass.thickness.value = 1;
		aoPass.scale.value = 1.1;
		scenePass.contextNode = builtinAOContext( aoPass.getTextureNode().sample( screenUV ).r );

	}

	const color = scenePass.getTextureNode( 'output' );
	const final = NO_BLOOM ? color : color.add( bloom( color, 0.3, 0.4, 0.9 ) );
	// soft vignette + slight warm grade
	const d = length( uv().sub( 0.5 ).mul( vec3( 1.15, 1, 1 ).xy ) );
	const vig = smoothstep( float( 0.95 ), float( 0.35 ), d ).mul( 0.35 ).add( 0.65 );
	const graded = mix( final.rgb, final.rgb.mul( vec3( 1.03, 1.0, 0.97 ) ), 0.5 ).mul( vig );
	pipeline.outputNode = vec4( graded, final.a );

	await progress( 0.88, 'Compiling shaders…' );
	kid.root.position.copy( player.pos );
	kid.root.rotation.y = player.yaw;
	cam.snap( new THREE.Vector3( player.pos.x, player.pos.y + 1.35, player.pos.z ), player.yaw );
	updateSun( sun, player.pos );
	try {

		await renderer.compileAsync( scene, camera );

	} catch ( e ) {

		console.warn( 'Shader precompile skipped', e );

	}

	await progress( 1, 'Play' );
	$( 'overlay' ).classList.remove( 'loading' );
	$( 'play' ).disabled = false;

	// ------------------------------------------------------------------------------------------
	let playing = false;
	let started = false;
	let elapsed = 0;
	let finished = false;
	const center = new THREE.Vector3();
	const focus = new THREE.Vector3();
	const lookPoint = new THREE.Vector3();

	const begin = () => {

		sfx.unlock();
		input.requestLock();
		$( 'overlay' ).hidden = true;
		$( 'hud' ).hidden = false;
		playing = true;
		if ( ! started ) {

			started = true;
			hud.hintLater();
			cam.snap( focus.set( player.pos.x, player.pos.y + 1.35, player.pos.z ), player.yaw );

		}

	};

	$( 'play' ).addEventListener( 'click', begin );
	$( 'again' ).addEventListener( 'click', () => {

		$( 'win' ).hidden = true;
		begin();

	} );
	renderer.domElement.addEventListener( 'click', () => {

		if ( playing && ! input.locked ) input.requestLock();

	} );
	document.addEventListener( 'pointerlockchange', () => {

		if ( ! document.pointerLockElement && playing && ! input.isTouch && ! finished ) {

			playing = false;
			$( 'play-label' ).textContent = 'Resume';
			$( 'overlay' ).hidden = false;

		}

	} );
	addEventListener( 'keydown', ( e ) => {

		if ( e.code === 'KeyM' ) sfx.muted = ! sfx.muted;
		if ( e.code === 'KeyR' && playing ) player.respawn();
		if ( ( e.code === 'Enter' || e.code === 'Space' ) && ! playing && ! $( 'play' ).disabled && $( 'win' ).hidden ) begin();

	} );

	addEventListener( 'resize', () => {

		camera.aspect = innerWidth / innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize( innerWidth, innerHeight );

	} );

	if ( params.has( 'debug' ) ) window.__game = { player, cam, renderer, scene, camera, hunt, physics, sun, input, zombies, animator, state: () => ( { playing, elapsed, frames: fpsTotal, lastDt } ) };
	const timer = new THREE.Timer();
	let attract = 0;
	let fpsAcc = 0, fpsFrames = 0, fpsTotal = 0, lastDt = 0;

	const tick = () => {

		timer.update();
		const dt = Math.min( timer.getDelta(), 1 / 20 );
		fpsTotal ++;
		lastDt = dt;
		fpsAcc += dt;
		fpsFrames ++;
		if ( fpsAcc > 1 ) {

			hud.setFps( fpsFrames / fpsAcc );
			fpsAcc = 0;
			fpsFrames = 0;

		}

		if ( playing ) {

			const intent = input.move();
			player.update( dt, intent, cam.yaw, input.run, input.consume( 'Space' ), input.consume( 'Attack' ) );
			for ( const ev of player.events ) {

				sfx.play( ev );
				if ( ev === 'hurt' ) animator.setExpression( 'hurt', 0.6 );
				if ( ev === 'kick' ) animator.setExpression( 'effort', 0.5 );
				if ( ev === 'die' ) hud.toast( 'The alley got you… back to the square', false );
				if ( ev === 'revive' ) cam.snap( focus.set( player.pos.x, player.pos.y + 1.35, player.pos.z ), player.yaw );

			}

			if ( player.kickLanding ) {

				const hits = zombies.kick( player.pos, player.yaw, ( z, killed ) => {

					sfx.play( killed ? 'kill' : 'kickHit' );
					if ( killed ) hud.setKills( zombies.killed );

				} );
				if ( hits ) animator.hitPulse = Math.max( animator.hitPulse, 0.25 );

			}

			if ( ! finished ) elapsed += dt;

		}

		const speed = Math.hypot( player.vel.x, player.vel.z );
		kid.root.position.copy( player.pos );
		kid.root.rotation.y = player.yaw;
		// she watches the nearest threatening zombie, otherwise where the camera looks
		let look = null;
		const threat = zombies.nearestThreat( player.pos );
		if ( threat < 14 ) {

			for ( const z of zombies.zombies ) {

				if ( ( z.state === 'chase' || z.state === 'attack' ) && z.pos.distanceTo( player.pos ) === threat ) look = lookPoint.set( z.pos.x, z.pos.y + 1.5, z.pos.z );

			}

		} else if ( speed < 0.5 ) {

			camera.getWorldDirection( lookPoint ).multiplyScalar( 12 ).add( camera.position );
			look = lookPoint;

		}

		animator.update( dt, {
			speed: player.climbing ? 0 : speed,
			run: input.run,
			grounded: player.grounded,
			vy: player.vel.y,
			climbing: player.climbing,
			swimming: player.swimming,
			flip: player.flip,
			landed: player.landed,
			turnRate: player.turnRate,
			attack: player.attackT,
			attackKind: 'kick',
			hit: player.hitFlag,
			dead: player.dead,
			lookAt: look,
			climbVy: player.climbing ? player.vel.y : 0,
		} );

		if ( playing || started ) {

			focus.set( player.pos.x, player.pos.y + 1.35, player.pos.z );
			cam.update( dt, focus, input, player.yaw, speed > 0.5 );

		} else {

			attract += dt * 0.05;
			const a = player.yaw + Math.PI + Math.sin( attract ) * 0.5;
			camera.position.set( player.pos.x + Math.sin( a ) * 4.2, player.pos.y + 1.7, player.pos.z + Math.cos( a ) * 4.2 );
			camera.lookAt( player.pos.x, player.pos.y + 1.6 + 0.4, player.pos.z );

		}

		center.set( player.pos.x, player.pos.y + 0.8, player.pos.z );
		hunt.update( dt, center, camera, ( item ) => {

			sfx.play( item.golden ? 'golden' : 'pocky' );
			animator.setExpression( 'flustered', item.golden ? 4 : 2.2 );
			hud.collect( hunt.collected, item.golden );
			if ( hunt.collected === hunt.total ) {

				finished = true;
				setTimeout( () => {

					playing = false;
					document.exitPointerLock?.();
					$( 'win-text' ).innerHTML = `You found all <b>${hunt.total}</b> boxes of Pocky in <b>${hud.formatTime( elapsed )}</b>, dropped <b>${zombies.killed}</b> zombies and went down <b>${player.deaths}</b> times. Highest perch: <b>${player.maxHeight.toFixed( 0 )} m</b>.`;
					$( 'win' ).hidden = false;

				}, 1500 );

			}

		} );
		if ( playing ) {

			zombies.update( dt, player, ( z, dmg ) => {

				player.damage( dmg, z.pos );

			}, sfx );

		}

		props.pigeons.update( dt, player.pos, speed, () => sfx.play( 'pigeons' ) );
		updateSun( sun, player.pos );
		sfx.setAltitude( player.pos.y );

		hud.setHealth( player.hp, player.maxHp, threat < 18 );
		hud.update( {
			time: elapsed,
			altitude: player.pos.y,
			stamina: player.stamina,
			climbing: player.climbing,
			camera,
			target: hunt.nearest( player.pos ),
			playerPos: player.pos,
		} );

		pipeline.render();
		input.endFrame();

	};

	renderer.setAnimationLoop( () => {

		try {

			tick();

		} catch ( e ) {

			console.error( 'frame error', e );
			throw e;

		}

	} );

}

boot().catch( ( err ) => {

	console.error( err );
	$( 'play-label' ).textContent = 'Could not start';
	$( 'foot' ).textContent = 'Your browser could not start WebGPU or WebGL 2: ' + ( err && err.message ? err.message : err );
	$( 'foot' ).classList.add( 'warn' );

} );
