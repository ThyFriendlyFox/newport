import * as THREE from 'three/webgpu';
import {
	float, vec3, uniform, smoothstep, dot, max, pow, normalize, mix, saturate,
	normalView, positionViewDirection, positionLocal, normalLocal, attribute, time, sin,
	BRDF_Lambert, diffuseColor, oneMinus,
} from 'three/tsl';

// Anime-PBR shading in the spirit of Ananta / Honkai-style toon: a soft two-band diffuse with a warm
// shadow tint, a tight glossy highlight, a cool fresnel rim lit from the camera, and a specular
// "angel ring" on hair driven by view-space normal height. Real shadow maps still apply because the
// light colour passed to the model already carries shadow attenuation.

class AnimeLightingModel extends THREE.LightingModel {

	constructor( params ) {

		super();
		this.params = params;

	}

	direct( { lightDirection, lightColor, reflectedLight } ) {

		const p = this.params;
		const n = normalView;
		const dotNL = dot( n, lightDirection );
		// two bands with a soft transition; the lower band keeps a sliver of light so shadowed
		// skin reads as warm instead of black
		const litA = smoothstep( p.threshold.sub( p.softness ), p.threshold.add( p.softness ), dotNL );
		const litB = smoothstep( float( - 0.35 ), float( 0.1 ), dotNL ).mul( 0.35 );
		const band = max( litA, litB );
		const shadowCol = diffuseColor.rgb.mul( p.shadowTint );
		const diffuse = mix( shadowCol.mul( 0.55 ), diffuseColor.rgb, band );
		reflectedLight.directDiffuse.addAssign( diffuse.mul( lightColor ) );

		// tight toon specular
		const h = normalize( lightDirection.add( positionViewDirection ) );
		const ndh = max( dot( n, h ), 0.0 );
		const spec = smoothstep( p.specEdge.sub( 0.02 ), p.specEdge.add( 0.02 ), pow( ndh, p.shininess ) );
		reflectedLight.directSpecular.addAssign( lightColor.mul( spec ).mul( p.specStrength ).mul( band ) );

		// hair angel ring: a band where the view-space normal tilts up a little
		if ( p.hair ) {

			const ring = smoothstep( 0.25, 0.32, n.y ).mul( smoothstep( 0.6, 0.5, n.y ) );
			reflectedLight.directSpecular.addAssign( lightColor.mul( ring ).mul( 0.35 ).mul( band.mul( 0.6 ).add( 0.4 ) ) );

		}

	}

	indirect( builder ) {

		const { ambientOcclusion, irradiance, reflectedLight } = builder.context;
		reflectedLight.indirectDiffuse.addAssign( irradiance.mul( BRDF_Lambert( { diffuseColor } ) ) );
		reflectedLight.indirectDiffuse.mulAssign( ambientOcclusion );

	}

}

export class AnimeMaterial extends THREE.MeshToonNodeMaterial {

	constructor( { map = null, hair = false, threshold = 0.08, softness = 0.08, shadowTint = 0xc98a8a, shininess = 48, specEdge = 0.45, specStrength = 0.18, rim = 0.35, rimColor = 0xdfe8ff, sway = false } = {} ) {

		super( { vertexColors: true, map } );
		this.params = {
			threshold: uniform( threshold ),
			softness: uniform( softness ),
			shadowTint: uniform( new THREE.Color( shadowTint ) ),
			shininess: uniform( shininess ),
			specEdge: uniform( specEdge ),
			specStrength: uniform( specStrength ),
			hair,
		};
		this.rimUniform = uniform( rim );
		this.rimColorUniform = uniform( new THREE.Color( rimColor ) );
		this.hitFlash = uniform( 0 );
		this.swayUniform = uniform( new THREE.Vector3() );
		this.swayAmount = uniform( 0 );

		// fresnel rim + hit flash
		const fres = pow( oneMinus( saturate( dot( normalView, positionViewDirection ) ) ), 3.0 );
		const rimTerm = fres.mul( this.rimUniform ).mul( smoothstep( - 0.2, 0.5, normalView.y.add( 0.3 ) ) );
		this.emissiveNode = vec3( this.rimColorUniform ).mul( rimTerm ).add( vec3( 1.0, 0.25, 0.2 ).mul( this.hitFlash ) );

		if ( sway ) {

			// hair / cloth secondary motion in the vertex shader: offset grows with the strand's
			// distance from its root (stored in uv.y of the strand) and follows an inertial vector
			const t = attribute( 'sway', 'float' );
			const wind = sin( time.mul( 2.3 ).add( positionLocal.x.mul( 9.0 ) ).add( positionLocal.y.mul( 5.0 ) ) ).mul( 0.004 );
			const offset = this.swayUniform.mul( t.mul( t ) ).add( vec3( wind, 0, wind.mul( 0.5 ) ).mul( t ) );
			this.positionNode = positionLocal.add( offset.mul( this.swayAmount ) );

		}

	}

	setupLightingModel() {

		return new AnimeLightingModel( this.params );

	}

}

export function makeOutlineMaterial( colorHex = 0x2a2030, thickness = 0.004 ) {

	const m = new THREE.MeshBasicNodeMaterial( { side: THREE.BackSide } );
	const outlineCol = uniform( new THREE.Color( colorHex ) );
	// tint the line with the surface colour so hair outlines stay in hue
	m.colorNode = mix( vec3( outlineCol ), attribute( 'color', 'vec3' ).mul( 0.35 ), 0.4 );
	// constant-ish screen thickness: scale by distance to camera
	m.positionNode = positionLocal.add( normalLocal.mul( float( thickness ) ) );
	m.thickness = thickness;
	return m;

}

