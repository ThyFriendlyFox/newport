import * as THREE from 'three/webgpu';

// Procedural animation for Rig instances. Poses are flat channel maps that get blended by state
// weight, then applied as FK rotations; legs (and arms while climbing) are solved with two-bone IK
// against foot/hand targets so feet plant on the ground and never slide. The tail is a verlet
// chain, hair sways in the vertex shader from body motion.

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _k = new THREE.Vector3(), _t = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const X = new THREE.Vector3( 1, 0, 0 );

const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
const smooth01 = ( t ) => ( t = clamp( t, 0, 1 ), t * t * ( 3 - 2 * t ) );
const ease = ( cur, target, rate, dt ) => cur + ( target - cur ) * ( 1 - Math.exp( - rate * dt ) );

export const KID_STYLE = {
	hipHeight: 0.915, stance: 0.07, strideMin: 0.42, strideK: 0.1, strideMax: 1.25, lift: 0.07, liftRun: 0.1,
	bob: 0.025, sway: 0.08, armSwing: 0.55, armSwingRun: 0.95, lean: 0.3, cadence: 1.0, asym: 0,
	idleBreath: 1, headLook: 1, elbow: 0.35, elbowRun: 1.5, knee: 1,
};

export const ZOMBIE_STYLE = {
	hipHeight: 0.84, stance: 0.1, strideMin: 0.32, strideK: 0.08, strideMax: 0.7, lift: 0.045, liftRun: 0.06,
	bob: 0.04, sway: 0.15, armSwing: 0.15, armSwingRun: 0.25, lean: 0.55, cadence: 1.0, asym: 0.45,
	idleBreath: 0.4, headLook: 0.6, elbow: 1.2, elbowRun: 1.3, knee: 1.1, hunch: 0.45, armsForward: 0.9,
};

// ---------------------------------------------------------------------------------------------

function basePose( style, s ) {

	return {
		hipsX: 0, hipsY: style.hipHeight * s, hipsZ: 0, hipsRX: 0, hipsRY: 0, hipsRZ: 0,
		spineRX: 0, spineRY: 0, spineRZ: 0, chestRX: 0, chestRY: 0, chestRZ: 0,
		neckRX: 0, neckRY: 0, neckRZ: 0, headRX: 0, headRY: 0, headRZ: 0,
		clavL: 0, clavR: 0,
		uArmL_X: 0, uArmL_Y: 0, uArmL_Z: - 0.12, fArmL: 0.15, handL_X: 0, handL_Y: 0, handL_Z: 0,
		uArmR_X: 0, uArmR_Y: 0, uArmR_Z: 0.12, fArmR: 0.15, handR_X: 0, handR_Y: 0, handR_Z: 0,
		armIK: 0, handLx: 0, handLy: 0, handLz: 0, handRx: 0, handRy: 0, handRz: 0,
		footLx: - style.stance * s - 0.035 * s, footLy: 0, footLz: 0, footLp: 0, toeL: 0,
		footRx: style.stance * s + 0.035 * s, footRy: 0, footRz: 0, footRp: 0, toeR: 0,
		kneeOut: 0,
	};

}

function blendInto( out, pose, w ) {

	for ( const k in pose ) out[ k ] = ( out[ k ] || 0 ) + pose[ k ] * w;

}

export class Animator {

	constructor( inst, spec, style, physics = null, ownsMaterial = true ) {

		this.ownsMaterial = ownsMaterial;

		this.inst = inst;
		this.spec = spec;
		this.style = style;
		this.physics = physics;
		this.s = spec.scale;
		this.b = inst.byName;
		this.root = inst.root;
		this.time = Math.random() * 10;
		this.phase = Math.random() * Math.PI * 2;
		this.weights = { ground: 1, air: 0, climb: 0, swim: 0, dead: 0, attack: 0 };
		this.moveF = 0;
		this.runF = 0;
		this.hitPulse = 0;
		this.squash = 0;
		this.prev = new THREE.Vector3();
		this.vel = new THREE.Vector3();
		this.swayV = new THREE.Vector3();
		this.prevYaw = 0;
		this.look = new THREE.Vector2();
		this.lookTarget = null;
		this.blinkT = 2 + Math.random() * 3;
		this.blinking = 0;
		this.expression = 'neutral';
		this.expressionT = 0;
		this.footGround = [ 0, 0 ];
		this.pose = null;
		this.deadT = 0;
		this.climbPhase = 0;
		this.faces = null;
		this.breath = Math.random() * 6;
		this.twitchT = 0;

		// bind world quaternions (character space, root at identity)
		for ( const bone of inst.bones ) {

			bone.updateWorldMatrix( true, false );
			bone.userData.bindWorldQ = new THREE.Quaternion().setFromRotationMatrix( bone.matrixWorld );

		}

		this.footBindQ = { L: this.b.footL.userData.bindWorldQ, R: this.b.footR.userData.bindWorldQ };
		this.ankleH = inst.ankleH;
		this.tail = [];
		if ( spec.tail ) this.initTail();

	}

	setFaces( faces ) {

		this.faces = faces;
		this.inst.faceMat.map = faces.neutral;

	}

	setExpression( name, duration = 2 ) {

		this.expression = name;
		this.expressionT = duration;
		this.applyFace();

	}

	applyFace() {

		if ( ! this.faces ) return;
		const f = this.faces;
		let tex = f[ this.expression ] || f.neutral;
		if ( this.blinking > 0 && this.expression !== 'hurt' ) tex = f.blink || tex;
		if ( this.inst.faceMat.map !== tex ) this.inst.faceMat.map = tex;

	}

	// ---- state ------------------------------------------------------------------------------
	// st: { speed, run, grounded, vy, climbing, swimming, flip, landed, turnRate, attack (0..1 | -1),
	//       attackKind, hit, dead, lookAt: Vector3|null, moveDir: {x,z} local, climbVy }
	update( dt, st ) {

		dt = Math.min( dt, 1 / 20 );
		this.time += dt;
		const S = this.style, s = this.s;
		const W = this.weights;
		const dead = !! st.dead;
		const targets = {
			ground: ! dead && st.grounded && ! st.climbing && ! st.swimming ? 1 : 0,
			air: ! dead && ! st.grounded && ! st.climbing && ! st.swimming ? 1 : 0,
			climb: ! dead && st.climbing ? 1 : 0,
			swim: ! dead && st.swimming ? 1 : 0,
			dead: dead ? 1 : 0,
			attack: ! dead && st.attack >= 0 ? 1 : 0,
		};
		for ( const k in W ) W[ k ] = ease( W[ k ], targets[ k ], k === 'attack' ? 22 : ( k === 'dead' ? 6 : 12 ), dt );
		if ( dead ) this.deadT += dt; else this.deadT = 0;

		this.moveF = ease( this.moveF, clamp( st.speed / 2.2, 0, 1 ), 10, dt );
		this.runF = ease( this.runF, st.run ? clamp( ( st.speed - 3.5 ) / 3.5, 0, 1 ) : 0, 8, dt );
		if ( st.landed ) this.squash = Math.min( 1, 0.3 + st.landed * 0.06 );
		this.squash = Math.max( 0, this.squash - dt * 3.2 );
		if ( st.hit ) this.hitPulse = 1;
		this.hitPulse = Math.max( 0, this.hitPulse - dt * 3 );

		// gait phase advances with distance travelled
		const stride = clamp( S.strideMin + st.speed * S.strideK, S.strideMin, S.strideMax ) * s;
		this.stride = stride;
		if ( W.ground > 0.01 && st.speed > 0.15 ) this.phase += dt * st.speed * Math.PI / stride * S.cadence;
		else if ( W.ground > 0.01 ) {

			// settle to the nearest double-support pose
			const rest = Math.round( this.phase / Math.PI ) * Math.PI;
			this.phase = ease( this.phase, rest, 6, dt );

		}

		if ( st.climbing ) this.climbPhase += dt * ( 1.5 + Math.abs( st.climbVy || 0 ) * 1.8 );
		if ( st.swimming ) this.climbPhase += dt * 4;

		// ---- blend poses ------------------------------------------------------------------
		const out = {};
		let total = 0;
		const add = ( w, pose ) => {

			if ( w < 0.002 ) return;
			blendInto( out, pose, w );
			total += w;

		};

		const attackW = W.attack;
		const baseW = 1 - attackW * ( st.attackKind === 'lunge' ? 0.85 : 0.7 );
		add( W.ground * baseW, this.poseGround( st ) );
		add( W.air * baseW, this.poseAir( st ) );
		add( W.climb * baseW, this.poseClimb( st ) );
		add( W.swim * baseW, this.poseSwim( st ) );
		add( W.dead, this.poseDead( st ) );
		if ( attackW > 0.002 ) add( attackW * ( 1 - W.dead ), this.poseAttack( st ) );
		for ( const k in out ) out[ k ] /= total;

		// overlays
		if ( this.hitPulse > 0 ) {

			const h = Math.sin( this.hitPulse * Math.PI ) * this.hitPulse;
			out.spineRX -= 0.35 * h;
			out.headRX -= 0.4 * h;
			out.uArmL_X -= 0.6 * h;
			out.uArmR_X -= 0.6 * h;
			out.hipsZ -= 0.05 * h * s;

		}

		if ( this.squash > 0 ) {

			const q = this.squash;
			out.hipsY -= 0.16 * q * s;
			out.spineRX += 0.35 * q;
			out.uArmL_Z -= 0.35 * q;
			out.uArmR_Z += 0.35 * q;
			out.uArmL_X -= 0.5 * q;
			out.uArmR_X -= 0.5 * q;

		}

		// breathing + head look
		this.breath += dt;
		out.chestRX += Math.sin( this.breath * 1.7 ) * 0.012 * S.idleBreath;
		out.clavL += Math.sin( this.breath * 1.7 ) * 0.02 * S.idleBreath;
		out.clavR += Math.sin( this.breath * 1.7 ) * 0.02 * S.idleBreath;
		this.updateLook( dt, st, out );

		// flip (double jump) spins the whole body about the hips
		if ( st.flip > 0 ) {

			out.hipsRX += ( 1 - smooth01( st.flip ) ) * Math.PI * 2;
			out.hipsY += Math.sin( ( 1 - st.flip ) * Math.PI ) * 0.25 * s;

		}

		// temporal smoothing of the final pose (fast, just removes blend jitter)
		if ( ! this.pose ) this.pose = { ...out };
		const P = this.pose;
		const rate = 1 - Math.exp( - dt * 30 );
		for ( const k in out ) P[ k ] += ( out[ k ] - P[ k ] ) * rate;

		this.apply( P, st, dt );
		this.updateFace( dt );
		this.updateSecondary( dt, st );

	}

	// ---- pose generators ----------------------------------------------------------------------
	poseGround( st ) {

		const S = this.style, s = this.s;
		const P = basePose( S, s );
		const m = this.moveF, run = this.runF;
		const stride = this.stride;
		const lift = lerp( S.lift, S.liftRun, run ) * s;
		const ph = this.phase;
		const t = this.time;

		for ( const side of [ 'L', 'R' ] ) {

			const sg = side === 'L' ? - 1 : 1;
			let p = ph + ( side === 'L' ? 0 : Math.PI );
			p = ( ( p % ( Math.PI * 2 ) ) + Math.PI * 2 ) % ( Math.PI * 2 );
			const asym = side === 'L' ? 1 - S.asym : 1;
			let z, y, pitch, toe = 0;
			if ( p < Math.PI ) {

				// stance: foot slides back linearly under the body → planted in world space
				const u = p / Math.PI;
				z = ( 0.5 - u ) * stride * asym;
				y = 0;
				pitch = u > 0.8 ? ( u - 0.8 ) / 0.2 * 0.6 : 0; // heel lifts for toe-off
				toe = u > 0.85 ? ( u - 0.85 ) / 0.15 * 0.8 : 0;

			} else {

				const u = ( p - Math.PI ) / Math.PI;
				z = ( - 0.5 + smooth01( u ) ) * stride * asym;
				y = Math.sin( u * Math.PI ) * lift * asym + ( run ? Math.sin( u * Math.PI ) * 0.03 * run : 0 );
				pitch = u < 0.5 ? 0.5 * ( 1 - u * 2 ) : - 0.25 * ( u - 0.5 ) * 2; // toe down then heel leads
				pitch *= asym;

			}

			const idleX = sg * ( S.stance + 0.035 ) * s;
			const walkX = sg * ( S.stance - run * 0.03 ) * s;
			P[ 'foot' + side + 'x' ] = lerp( idleX, walkX, m );
			P[ 'foot' + side + 'z' ] = lerp( sg * - 0.02 * s, z, m ) + S.asym * 0.04 * s;
			P[ 'foot' + side + 'y' ] = y * m;
			P[ 'foot' + side + 'p' ] = pitch * m;
			P[ 'toe' + side ] = toe * m;

			// arms counter-swing
			const armPh = ph + ( side === 'L' ? Math.PI : 0 );
			const swing = Math.cos( armPh ) * lerp( S.armSwing, S.armSwingRun, run ) * m;
			P[ 'uArm' + side + '_X' ] = swing + ( S.armsForward || 0 ) * ( 0.6 + 0.4 * m ) + run * 0.25;
			P[ 'uArm' + side + '_Z' ] = sg * ( 0.1 + run * 0.12 + ( S.armsForward ? 0.08 : 0 ) );
			P[ 'uArm' + side + '_Y' ] = sg * ( S.armsForward ? - 0.25 : 0 );
			P[ 'fArm' + side ] = lerp( S.elbow, S.elbowRun, run ) * ( 0.4 + 0.6 * m ) + Math.max( 0, swing ) * 0.6 + ( S.armsForward ? 0.5 : 0 );
			P[ 'hand' + side + '_X' ] = S.armsForward ? 0.4 + Math.sin( t * 3 + sg ) * 0.1 : - 0.15;
			P[ 'hand' + side + '_Z' ] = sg * 0.1;

		}

		// pelvis & spine motion
		const bob = lerp( Math.abs( Math.sin( ph ) ), 1 - Math.abs( Math.sin( ph ) ) * 0.6, run ) * S.bob * s * m;
		P.hipsY += bob - S.bob * s * 0.5 * m - run * 0.06 * s;
		P.hipsX = Math.sin( ph ) * S.sway * 0.25 * s * m;
		P.hipsRZ = Math.sin( ph ) * S.sway * m * ( 1 - run * 0.5 );
		P.hipsRY = - Math.cos( ph ) * 0.12 * m * ( 1 + run * 0.6 );
		P.hipsRX = S.lean * ( 0.15 * m + 0.6 * run ) + ( S.hunch || 0 ) * 0.4;
		P.spineRX = S.lean * ( 0.1 * m + 0.35 * run ) + ( S.hunch || 0 ) * 0.5;
		P.spineRY = Math.cos( ph ) * 0.1 * m * ( 1 + run );
		P.chestRX = ( S.hunch || 0 ) * 0.45 + run * 0.1;
		P.chestRY = Math.cos( ph ) * 0.08 * m;
		P.chestRZ = - Math.sin( ph ) * 0.04 * m;
		P.neckRX = - ( S.hunch || 0 ) * 0.5 - run * 0.15;
		P.headRX = - ( S.hunch || 0 ) * 0.4 - S.lean * 0.1 * run;
		P.headRZ = Math.sin( ph ) * 0.02 * m;

		// idle: weight shifts, subtle sway
		const idle = 1 - m;
		P.hipsX += Math.sin( t * 0.5 ) * 0.012 * s * idle;
		P.hipsRZ += Math.sin( t * 0.5 ) * 0.03 * idle;
		P.spineRZ += - Math.sin( t * 0.5 ) * 0.025 * idle;
		P.hipsY -= 0.004 * s * idle * ( 1 + Math.sin( t * 1.7 ) );
		if ( S.hunch ) {

			// zombie idle twitches
			P.headRZ += Math.sin( t * 0.9 ) * 0.12 + ( Math.sin( t * 7.3 ) > 0.97 ? 0.3 : 0 );
			P.headRY += Math.sin( t * 0.6 + 1 ) * 0.3;
			P.hipsRZ += Math.sin( t * 0.8 ) * 0.03;

		}

		return P;

	}

	poseAir( st ) {

		const S = this.style, s = this.s;
		const P = basePose( S, s );
		const rising = clamp( st.vy / 8, - 1, 1 );
		const up = Math.max( 0, rising ), down = Math.max( 0, - rising );
		P.hipsY += 0.02 * s;
		// legs: lead leg tucks on the way up, both extend/prepare on the way down
		P.footLx = - ( S.stance + 0.04 ) * s;
		P.footRx = ( S.stance + 0.04 ) * s;
		P.footLy = ( 0.25 * up + 0.12 ) * s;
		P.footLz = ( 0.22 * up + 0.05 ) * s;
		P.footLp = 0.5;
		P.footRy = ( 0.08 + 0.1 * down ) * s;
		P.footRz = ( - 0.12 + 0.05 * down ) * s;
		P.footRp = 0.7 - down * 0.5;
		P.hipsRX = 0.15 * up - 0.1 * down;
		P.spineRX = 0.1 * up - 0.12 * down;
		P.headRX = - 0.1 * up + 0.2 * down;
		P.uArmL_X = 0.5 + 1.3 * up - 0.3 * down;
		P.uArmR_X = 0.3 + 1.6 * up - 0.3 * down;
		P.uArmL_Z = - ( 0.5 + 0.5 * down );
		P.uArmR_Z = 0.6 + 0.5 * down;
		P.fArmL = 0.6;
		P.fArmR = 0.5;
		P.handL_X = - 0.2;
		P.handR_X = - 0.2;
		if ( st.flip > 0 ) {

			const tuck = Math.sin( ( 1 - st.flip ) * Math.PI );
			P.footLy = P.footRy = ( 0.12 + 0.45 * tuck ) * s;
			P.footLz = P.footRz = ( 0.05 + 0.25 * tuck ) * s;
			P.footLp = P.footRp = 0.6;
			P.spineRX = 0.5 * tuck;
			P.chestRX = 0.3 * tuck;
			P.headRX = 0.4 * tuck;
			P.uArmL_X = P.uArmR_X = 0.4 + 1.2 * tuck;
			P.uArmL_Z = - 0.2;
			P.uArmR_Z = 0.2;
			P.fArmL = P.fArmR = 1.6 * tuck + 0.3;

		}

		return P;

	}

	poseClimb( st ) {

		const S = this.style, s = this.s;
		const P = basePose( S, s );
		const c = Math.sin( this.climbPhase ), c2 = Math.cos( this.climbPhase );
		const moving = Math.abs( st.climbVy || 0 ) > 0.1 ? 1 : 0;
		P.hipsZ = 0.08 * s;
		P.hipsY = 0.88 * s;
		P.hipsRX = 0.2;
		P.spineRX = 0.18;
		P.chestRX = 0.1;
		P.neckRX = - 0.5;
		P.headRX = - 0.45;
		P.armIK = 1;
		// hands reach alternately up the wall
		P.handLx = - 0.24 * s;
		P.handRx = 0.24 * s;
		P.handLy = ( 1.55 + 0.22 * c * moving + 0.08 * ( 1 - moving ) ) * s;
		P.handRy = ( 1.55 - 0.22 * c * moving + 0.08 * ( 1 - moving ) ) * s;
		P.handLz = P.handRz = 0.36 * s;
		// feet on the wall
		P.footLx = - 0.16 * s;
		P.footRx = 0.16 * s;
		P.footLy = ( 0.32 - 0.16 * c2 * moving ) * s;
		P.footRy = ( 0.32 + 0.16 * c2 * moving ) * s;
		P.footLz = P.footRz = 0.3 * s;
		P.footLp = P.footRp = 0.9;
		P.kneeOut = 0.35;
		return P;

	}

	poseSwim( st ) {

		const S = this.style, s = this.s;
		const P = basePose( S, s );
		const ph = this.climbPhase;
		const m = 0.4 + 0.6 * this.moveF;
		P.hipsY = 0.62 * s;
		P.hipsRX = 1.35; // horizontal, face down
		P.spineRX = - 0.15;
		P.chestRX = - 0.1;
		P.neckRX = - 0.7;
		P.headRX = - 0.55;
		// legs kick, expressed in the hips frame (rotated along with the body)
		const kick = ( sg ) => {

			const k = Math.sin( ph + ( sg < 0 ? 0 : Math.PI ) ) * 0.2 * m;
			_a.set( sg * ( S.stance + 0.02 ) * s, - 0.78 * s + Math.max( 0, - k ) * 0.3 * s, k * s );
			_a.applyAxisAngle( X, P.hipsRX );
			return _a;

		};

		const l = kick( - 1 );
		P.footLx = l.x; P.footLy = P.hipsY + l.y - this.ankleH; P.footLz = l.z;
		const r = kick( 1 );
		P.footRx = r.x; P.footRy = P.hipsY + r.y - this.ankleH; P.footRz = r.z;
		P.footLp = P.footRp = 0.9;
		P.kneeOut = 0.1;
		// crawl stroke
		P.uArmL_X = 1.6 + Math.sin( ph * 0.5 ) * 1.4;
		P.uArmR_X = 1.6 + Math.sin( ph * 0.5 + Math.PI ) * 1.4;
		P.uArmL_Z = - 0.35;
		P.uArmR_Z = 0.35;
		P.fArmL = 0.3 + Math.max( 0, Math.cos( ph * 0.5 ) ) * 0.9;
		P.fArmR = 0.3 + Math.max( 0, Math.cos( ph * 0.5 + Math.PI ) ) * 0.9;
		void st;
		return P;

	}

	poseDead() {

		const S = this.style, s = this.s;
		const P = basePose( S, s );
		const t = smooth01( this.deadT / 0.7 );
		P.hipsY = lerp( S.hipHeight * s, 0.14 * s, t );
		P.hipsZ = - 0.3 * s * t;
		P.hipsRX = - Math.PI / 2 * t; // onto the back
		P.spineRX = - 0.1 * t;
		P.headRX = - 0.3 * t;
		P.headRZ = 0.4 * t;
		P.uArmL_X = 1.6 * t;
		P.uArmR_X = 0.4 * t;
		P.uArmL_Z = - 0.9 * t;
		P.uArmR_Z = 1.2 * t;
		P.fArmL = 0.9 * t;
		P.fArmR = 0.3;
		// feet trail behind, expressed in hips frame
		for ( const sg of [ - 1, 1 ] ) {

			_a.set( sg * ( S.stance + 0.08 * ( sg > 0 ? 1 : 0.3 ) ) * s, - 0.78 * s, ( sg > 0 ? 0.12 : - 0.05 ) * s );
			_a.applyAxisAngle( X, P.hipsRX );
			const side = sg < 0 ? 'L' : 'R';
			P[ 'foot' + side + 'x' ] = _a.x;
			P[ 'foot' + side + 'y' ] = Math.max( 0.0, P.hipsY + _a.y - this.ankleH );
			P[ 'foot' + side + 'z' ] = P.hipsZ + _a.z;
			P[ 'foot' + side + 'p' ] = 0.8 * t;

		}

		P.kneeOut = 0.3 * t;
		return P;

	}

	poseAttack( st ) {

		const S = this.style, s = this.s;
		const P = this.poseGround( st );
		const t = clamp( st.attack, 0, 1 );
		if ( st.attackKind === 'lunge' ) {

			// zombie lunge: rear back, then throw both arms and the torso forward
			const wind = smooth01( t / 0.3 ) * ( 1 - smooth01( ( t - 0.3 ) / 0.15 ) );
			const strike = smooth01( ( t - 0.3 ) / 0.15 ) * ( 1 - smooth01( ( t - 0.7 ) / 0.3 ) );
			P.hipsRX += - 0.25 * wind + 0.55 * strike;
			P.spineRX += - 0.1 * wind + 0.35 * strike;
			P.hipsZ += - 0.08 * s * wind + 0.22 * s * strike;
			P.hipsY += - 0.05 * s * strike;
			P.neckRX += 0.3 * wind - 0.2 * strike;
			P.headRX += 0.2 * wind - 0.3 * strike;
			P.uArmL_X += - 0.6 * wind + 1.9 * strike;
			P.uArmR_X += - 0.6 * wind + 1.9 * strike;
			P.uArmL_Z += - 0.3 * wind;
			P.uArmR_Z += 0.3 * wind;
			P.fArmL -= 0.4 * strike;
			P.fArmR -= 0.4 * strike;
			P.handL_X = 0.5 - strike;
			P.handR_X = 0.5 - strike;
			P.footRz += 0.25 * s * strike;
			P.footRy += 0.08 * s * strike * ( 1 - strike );

		} else {

			// roundhouse-ish kick with the right leg
			const wind = smooth01( t / 0.22 ) * ( 1 - smooth01( ( t - 0.22 ) / 0.12 ) );
			const strike = smooth01( ( t - 0.22 ) / 0.12 ) * ( 1 - smooth01( ( t - 0.55 ) / 0.3 ) );
			const peak = Math.max( wind, strike );
			P.hipsY += - 0.08 * s * peak;
			P.hipsRX += - 0.3 * wind - 0.15 * strike;
			P.hipsRY += 0.35 * wind - 0.7 * strike;
			P.spineRX += - 0.2 * wind + 0.1 * strike;
			P.spineRY += 0.3 * wind - 0.5 * strike;
			P.chestRY += 0.2 * wind - 0.3 * strike;
			P.headRY += - 0.3 * wind + 0.4 * strike;
			P.footRy = ( 0.12 * wind + 0.95 * strike ) * s;
			P.footRz = ( - 0.35 * wind + 0.75 * strike ) * s;
			P.footRx = ( 0.12 + 0.1 * strike ) * s;
			P.footRp = 0.9 * strike + 0.3 * wind;
			P.footLx = - 0.13 * s;
			P.footLz = - 0.02 * s;
			P.footLy = 0;
			P.kneeOut = 0.4 * strike;
			P.uArmL_X += - 0.9 * peak;
			P.uArmL_Z += - 0.7 * peak;
			P.uArmR_X += 0.6 * wind - 0.2 * strike;
			P.uArmR_Z += 0.5 * peak;
			P.fArmL += 1.2 * peak;
			P.fArmR += 0.8 * peak;

		}

		return P;

	}

	// ---- apply --------------------------------------------------------------------------------
	setBone( name, rx, ry, rz ) {

		const bone = this.b[ name ];
		_e.set( rx, ry, rz, 'XYZ' );
		_q.setFromEuler( _e );
		bone.quaternion.copy( bone.userData.bind ).multiply( _q );

	}

	apply( P, st, dt ) {

		const b = this.b, s = this.s;
		const hips = b.hips;
		hips.position.set( P.hipsX, P.hipsY, P.hipsZ );
		this.setBone( 'hips', P.hipsRX, P.hipsRY, P.hipsRZ );
		this.setBone( 'spine', P.spineRX, P.spineRY, P.spineRZ );
		this.setBone( 'chest', P.chestRX, P.chestRY, P.chestRZ );
		this.setBone( 'neck', P.neckRX, P.neckRY, P.neckRZ );
		this.setBone( 'head', P.headRX, P.headRY, P.headRZ );
		this.setBone( 'clavicleL', 0, 0, - P.clavL );
		this.setBone( 'clavicleR', 0, 0, P.clavR );
		for ( const side of [ 'L', 'R' ] ) {

			this.setBone( 'upperArm' + side, P[ 'uArm' + side + '_X' ], P[ 'uArm' + side + '_Y' ], P[ 'uArm' + side + '_Z' ] );
			this.setBone( 'forearm' + side, P[ 'fArm' + side ], 0, 0 );
			this.setBone( 'hand' + side, P[ 'hand' + side + '_X' ], P[ 'hand' + side + '_Y' ], P[ 'hand' + side + '_Z' ] );
			// provisional FK for the legs so matrices are sane before IK
			this.setBone( 'upperLeg' + side, 0, 0, 0 );
			this.setBone( 'lowerLeg' + side, 0, 0, 0 );
			this.setBone( 'foot' + side, 0, 0, 0 );
			this.setBone( 'toe' + side, P[ 'toe' + side ], 0, 0 );

		}

		this.root.updateMatrixWorld( true );

		// feet: ground probe so planted feet follow slopes/steps
		for ( const [ i, side ] of [ 'L', 'R' ].entries() ) {

			_a.set( P[ 'foot' + side + 'x' ], P[ 'foot' + side + 'y' ], P[ 'foot' + side + 'z' ] );
			let gy = 0;
			if ( this.physics && this.weights.ground > 0.5 && st.grounded ) {

				_b.copy( _a );
				this.root.localToWorld( _b );
				const g = this.physics.groundAt( _b.x, _b.z, this.root.position.y + 0.6, 0.9 );
				gy = clamp( g - this.root.position.y, - 0.35, 0.35 );
				if ( g < - 40 ) gy = 0;

			}

			this.footGround[ i ] = ease( this.footGround[ i ], gy, 14, dt );
			_a.y += this.ankleH + this.footGround[ i ] * ( 1 - Math.min( 1, P[ 'foot' + side + 'y' ] / ( 0.08 * s ) ) * 0.5 );
			this.root.localToWorld( _a );
			// knee pole: forward of the hip, tilted outward
			_k.set( ( side === 'L' ? - 1 : 1 ) * ( 0.35 + P.kneeOut ), 0, 1 ).normalize().transformDirection( this.root.matrixWorld );
			this.twoBoneIK( b[ 'upperLeg' + side ], b[ 'lowerLeg' + side ], b[ 'foot' + side ], _a, _k );
			// foot orientation: flat on the ground, plus pitch (positive = toes down)
			_q.copy( this.footBindQ[ side ] );
			this.root.getWorldQuaternion( _q2 );
			_q3.setFromAxisAngle( X, - P[ 'foot' + side + 'p' ] );
			_q.premultiply( _q2 ).multiply( _q3 );
			const foot = b[ 'foot' + side ];
			foot.parent.getWorldQuaternion( _q2 );
			foot.quaternion.copy( _q2.invert().multiply( _q ) );

		}

		// hands on the wall while climbing
		if ( P.armIK > 0.01 ) {

			for ( const side of [ 'L', 'R' ] ) {

				_a.set( P[ 'hand' + side + 'x' ], P[ 'hand' + side + 'y' ], P[ 'hand' + side + 'z' ] );
				this.root.localToWorld( _a );
				_k.set( ( side === 'L' ? - 1 : 1 ) * 0.6, - 0.3, - 1 ).normalize().transformDirection( this.root.matrixWorld );
				_q.copy( b[ 'upperArm' + side ].quaternion );
				_q2.copy( b[ 'forearm' + side ].quaternion );
				this.twoBoneIK( b[ 'upperArm' + side ], b[ 'forearm' + side ], b[ 'hand' + side ], _a, _k );
				b[ 'upperArm' + side ].quaternion.slerp( _q, 1 - P.armIK );
				b[ 'forearm' + side ].quaternion.slerp( _q2, 1 - P.armIK );

			}

		}

	}

	// Analytic two-bone IK. upper→lower→end bones; target (point) & pole (direction) in world space.
	twoBoneIK( upper, lower, end, target, pole ) {

		_t.copy( target );
		upper.updateWorldMatrix( true, false );
		_a.setFromMatrixPosition( upper.matrixWorld );
		const L1 = lower.position.length(), L2 = end.position.length();
		_b.subVectors( _t, _a );
		let d = _b.length();
		d = clamp( d, 0.02, ( L1 + L2 ) * 0.995 );
		_b.normalize();
		const cosA = clamp( ( L1 * L1 + d * d - L2 * L2 ) / ( 2 * L1 * d ), - 1, 1 );
		const ang = Math.acos( cosA );
		_c.copy( pole );
		_c.addScaledVector( _b, - _c.dot( _b ) );
		if ( _c.lengthSq() < 1e-6 ) _c.set( 0, 0, 1 );
		_c.normalize();
		_d.copy( _b ).multiplyScalar( Math.cos( ang ) ).addScaledVector( _c, Math.sin( ang ) ); // knee dir
		// upper bone world rotation: +Y along knee dir, +Z toward pole
		const qUpper = basisQuat( _d, _c, _q );
		upper.parent.getWorldQuaternion( _q2 );
		upper.quaternion.copy( _q2.invert().multiply( qUpper ) );
		// lower bone
		_a.addScaledVector( _d, L1 );
		_b.subVectors( _t, _a ).normalize();
		const qLower = basisQuat( _b, _c, _q3 );
		lower.quaternion.copy( qUpper.clone().invert().multiply( qLower ) );

	}

	// ---- look-at, face, secondary ----------------------------------------------------------
	updateLook( dt, st, out ) {

		let ty = 0, tp = 0;
		if ( st.lookAt ) {

			_a.copy( st.lookAt );
			this.root.worldToLocal( _a );
			_a.y -= 1.5 * this.s;
			const yaw = Math.atan2( _a.x, _a.z );
			const pitch = - Math.atan2( _a.y, Math.hypot( _a.x, _a.z ) );
			if ( Math.abs( yaw ) < 1.6 ) {

				ty = clamp( yaw, - 1.1, 1.1 );
				tp = clamp( pitch, - 0.6, 0.6 );

			}

		}

		this.look.x = ease( this.look.x, ty, 5, dt );
		this.look.y = ease( this.look.y, tp, 5, dt );
		const L = this.style.headLook;
		out.headRY += this.look.x * 0.55 * L;
		out.neckRY += this.look.x * 0.3 * L;
		out.chestRY += this.look.x * 0.12 * L;
		out.headRX += this.look.y * 0.6 * L;
		out.neckRX += this.look.y * 0.3 * L;

	}

	updateFace( dt ) {

		this.blinkT -= dt;
		if ( this.blinkT < 0 ) {

			this.blinking = 0.13;
			this.blinkT = 1.8 + Math.random() * 4;

		}

		if ( this.blinking > 0 ) this.blinking -= dt;
		if ( this.expressionT > 0 ) {

			this.expressionT -= dt;
			if ( this.expressionT <= 0 ) this.expression = 'neutral';

		}

		this.applyFace();

	}

	initTail() {

		const T = this.spec.tail;
		for ( let i = 0; i < T.segments; i ++ ) {

			const bone = this.b[ 'tail' + i ];
			this.tail.push( { bone, pos: new THREE.Vector3(), prev: new THREE.Vector3(), len: T.segLen * this.s } );

		}

		this.tailInit = false;

	}

	updateSecondary( dt, st ) {

		// body velocity for hair sway (in character space)
		_a.copy( this.root.position ).sub( this.prev ).divideScalar( Math.max( dt, 1e-4 ) );
		this.prev.copy( this.root.position );
		this.vel.lerp( _a, 0.3 );
		let dyaw = this.root.rotation.y - this.prevYaw;
		dyaw = Math.atan2( Math.sin( dyaw ), Math.cos( dyaw ) );
		this.prevYaw = this.root.rotation.y;
		_b.copy( this.vel );
		this.root.getWorldQuaternion( _q ).invert();
		_b.applyQuaternion( _q );
		const target = new THREE.Vector3( - _b.x * 0.012 + dyaw / Math.max( dt, 1e-4 ) * 0.004, - Math.max( - 6, Math.min( 6, _b.y ) ) * 0.015, - _b.z * 0.012 );
		this.swayV.lerp( target, 1 - Math.exp( - dt * 6 ) );
		const mat = this.inst.mesh.material;
		if ( mat.swayUniform && this.ownsMaterial ) {

			mat.swayUniform.value.copy( this.swayV );
			mat.swayAmount.value = 1;

		}

		// tail: verlet chain in world space, anchored to its first bone
		if ( this.tail.length ) {

			const T = this.tail;
			const anchorBone = T[ 0 ].bone;
			anchorBone.parent.updateWorldMatrix( true, false );
			_a.setFromMatrixPosition( anchorBone.parent.matrixWorld );
			// rest direction: tail base points back and slightly down from the hips
			anchorBone.parent.getWorldQuaternion( _q2 );
			const grav = st.swimming ? 0.2 : 6;
			if ( ! this.tailInit ) {

				this.tailInit = true;
				const dir = new THREE.Vector3( 0, - 0.2, - 1 ).applyQuaternion( _q2 ).normalize();
				_c.copy( _a );
				for ( let i = 0; i < T.length; i ++ ) {

					_c.addScaledVector( dir, T[ i ].len );
					T[ i ].pos.copy( _c );
					T[ i ].prev.copy( _c );

				}

			}

			const run = this.runF, moving = this.moveF;
			const wave = this.time * ( 2.5 + run * 4 );
			const base = new THREE.Vector3( 0, - 0.12, - 1 ).applyQuaternion( _q2 );
			for ( let i = 0; i < T.length; i ++ ) {

				const n = T[ i ];
				_b.copy( n.pos ).sub( n.prev ).multiplyScalar( 0.92 );
				n.prev.copy( n.pos );
				n.pos.add( _b );
				n.pos.y -= grav * dt * dt * ( 0.4 + i * 0.08 );
				// stiffness toward a lively S-curve rest pose (curls up at idle, streams when running)
				const k = i / ( T.length - 1 );
				const lift = ( 0.9 + run * 0.6 ) * k * k - 0.2 * k + Math.sin( wave - i * 0.6 ) * ( 0.15 + moving * 0.2 ) * k;
				const sideSway = Math.sin( wave * 0.5 - i * 0.5 ) * 0.4 * k;
				_c.set( sideSway, lift, 0 ).applyQuaternion( _q2 ).add( base ).normalize();
				_d.copy( i === 0 ? _a : T[ i - 1 ].pos ).addScaledVector( _c, n.len );
				n.pos.lerp( _d, 1 - Math.exp( - dt * ( 7 - k * 3 ) ) );

			}

			// distance constraints
			for ( let iter = 0; iter < 3; iter ++ ) {

				for ( let i = 0; i < T.length; i ++ ) {

					const n = T[ i ];
					const from = i === 0 ? _a : T[ i - 1 ].pos;
					_b.subVectors( n.pos, from );
					const l = _b.length() || 1e-4;
					n.pos.copy( from ).addScaledVector( _b, n.len / l );

				}

			}

			// write bones: each bone's +Y points to the next point
			let parentQ = _q2.clone();
			let from = _a.clone();
			for ( let i = 0; i < T.length; i ++ ) {

				const n = T[ i ];
				_b.subVectors( n.pos, from ).normalize();
				const up = new THREE.Vector3( 0, 1, 0 );
				const qw = basisQuat( _b, up, _q3 );
				n.bone.quaternion.copy( parentQ.clone().invert().multiply( qw ) );
				parentQ = qw.clone();
				from = n.pos;

			}

		}

	}

}

// Quaternion whose +Y is `dir` and whose +Z lies toward `zHint`.
function basisQuat( dir, zHint, out ) {

	const y = dir.clone().normalize();
	const z = zHint.clone().addScaledVector( y, - zHint.dot( y ) );
	if ( z.lengthSq() < 1e-6 ) z.set( 0, 0, 1 ).addScaledVector( y, - y.z );
	if ( z.lengthSq() < 1e-6 ) z.set( 1, 0, 0 );
	z.normalize();
	const x = new THREE.Vector3().crossVectors( y, z );
	_m.makeBasis( x, y, z );
	return out.setFromRotationMatrix( _m );

}

