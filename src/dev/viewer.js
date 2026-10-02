// Character viewer: /viewer.html?spec=kid|z0|z1|z2&anim=walk|run|idle|air|climb|swim|kick|lunge|dead
import * as THREE from 'three/webgpu';
import { createCharacterAtlas } from '../characters/atlas.js';
import { Rig } from '../characters/rig.js';
import { Animator, KID_STYLE, ZOMBIE_STYLE } from '../characters/animator.js';
import { makeFaceSet } from '../characters/faces.js';
import { PROTAGONIST, ZOMBIES } from '../characters/specs.js';

const params = new URLSearchParams( location.search );
const specName = params.get( 'spec' ) || 'kid';
const anim = params.get( 'anim' ) || 'idle';
const spec = specName === 'kid' ? PROTAGONIST : ZOMBIES[ Number( specName[ 1 ] ) || 0 ];

const renderer = new THREE.WebGPURenderer( { antialias: true, forceWebGL: params.has( 'webgl' ) } );
renderer.setPixelRatio( 1 );
renderer.setSize( innerWidth, innerHeight );
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
document.body.appendChild( renderer.domElement );
document.body.style.margin = '0';
await renderer.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color( 0xdfe6ee );
const camera = new THREE.PerspectiveCamera( 35, innerWidth / innerHeight, 0.05, 100 );
const dist = Number( params.get( 'dist' ) || 3.6 );
camera.position.set( dist * 0.6, 1.1, dist * 0.8 );
camera.lookAt( 0, 0.85, 0 );

scene.add( new THREE.HemisphereLight( 0xdfe8ff, 0xb59a74, 0.8 ) );
const sun = new THREE.DirectionalLight( 0xfff1dc, 2.6 );
sun.position.set( 3, 6, 4 );
sun.castShadow = true;
sun.shadow.mapSize.set( 2048, 2048 );
Object.assign( sun.shadow.camera, { left: - 3, right: 3, top: 3, bottom: - 3, near: 1, far: 20 } );
sun.shadow.bias = - 0.0005;
sun.shadow.normalBias = 0.02;
scene.add( sun );
const ground = new THREE.Mesh( new THREE.PlaneGeometry( 20, 20 ), new THREE.MeshStandardMaterial( { color: 0xb8b0a4 } ) );
ground.rotation.x = - Math.PI / 2;
ground.receiveShadow = true;
scene.add( ground );

const atlas = createCharacterAtlas();
const rig = new Rig( spec, atlas );
{
	const pos = rig.geometry.attributes.position;
	for ( let i = 0; i < pos.count; i ++ ) {

		if ( Number.isNaN( pos.getX( i ) ) || Number.isNaN( pos.getY( i ) ) || Number.isNaN( pos.getZ( i ) ) ) {

			const part = rig.builder.parts.find( ( q ) => i >= q.start && i < q.end );
			console.log( 'NaN at vertex', i, 'part bones', part && part.bones.join( ',' ), 'partStart', part && part.start );
			break;

		}

	}

}
const inst = rig.createInstance();
scene.add( inst.root );
const animator = new Animator( inst, spec, spec.name === 'kid' ? KID_STYLE : ZOMBIE_STYLE, null );
animator.setFaces( makeFaceSet( spec ) );
if ( params.has( 'skel' ) ) scene.add( new THREE.SkeletonHelper( inst.root ) );
if ( params.get( 'face' ) ) animator.setExpression( params.get( 'face' ), 1e9 );

const st = {
	speed: 0, run: false, grounded: true, vy: 0, climbing: false, swimming: false, flip: 0, landed: 0, turnRate: 0,
	attack: - 1, attackKind: 'kick', hit: false, dead: false, lookAt: null, climbVy: 0,
};
switch ( anim ) {

	case 'walk': st.speed = 3.2; break;
	case 'run': st.speed = 7.4; st.run = true; break;
	case 'air': st.grounded = false; st.vy = 5; break;
	case 'fall': st.grounded = false; st.vy = - 6; break;
	case 'flip': st.grounded = false; st.vy = 3; st.flip = 0.6; break;
	case 'climb': st.climbing = true; st.climbVy = 3; break;
	case 'swim': st.swimming = true; st.speed = 2; break;
	case 'kick': st.attack = 0.35; break;
	case 'lunge': st.attack = 0.42; st.attackKind = 'lunge'; break;
	case 'dead': st.dead = true; break;
	default: break;

}

let t = 0;
const clock = new THREE.Clock();
renderer.setAnimationLoop( () => {

	const dt = Math.min( clock.getDelta(), 0.05 );
	t += dt;
	if ( anim === 'walk' || anim === 'run' ) inst.root.position.z += 0; // treadmill: root stays, gait phase advances
	if ( anim === 'kick' || anim === 'lunge' ) st.attack = ( t % 1.2 ) / 1.2 * 1.3;
	if ( params.has( 'orbit' ) ) inst.root.rotation.y = t * 0.6;
	animator.update( dt, st );
	renderer.render( scene, camera );
	window.__frames = ( window.__frames || 0 ) + 1;

} );
