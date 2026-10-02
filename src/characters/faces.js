import * as THREE from 'three/webgpu';

// Painted anime faces, projected onto the front of the head. Texture space: u across the face,
// v up; the eye line sits at v ≈ 0.45 and the mouth at v ≈ 0.23 (see Rig.buildFacePatch).

const S = 512;

function tex( c ) {

	const t = new THREE.CanvasTexture( c );
	t.colorSpace = THREE.SRGBColorSpace;
	t.anisotropy = 8;
	t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
	t.needsUpdate = true;
	return t;

}

function eye( ctx, ex, ey, side, { iris, irisDark, open = 1, size = 1, glazed = false, pupilScale = 1, lashColor = '#2a1a14' } ) {

	const ew = S * 0.085 * size, eh = S * 0.09 * size * open;
	if ( open < 0.12 ) {

		ctx.strokeStyle = lashColor;
		ctx.lineWidth = 7;
		ctx.lineCap = 'round';
		ctx.beginPath();
		ctx.moveTo( ex - ew, ey );
		ctx.quadraticCurveTo( ex, ey + 12, ex + ew, ey );
		ctx.stroke();
		return;

	}

	ctx.save();
	ctx.beginPath();
	ctx.ellipse( ex, ey, ew, eh, 0, 0, Math.PI * 2 );
	ctx.clip();
	ctx.fillStyle = glazed ? '#e9e4cf' : '#fbf8f4';
	ctx.fillRect( ex - ew, ey - eh, ew * 2, eh * 2 );
	// iris
	const ir = ew * ( glazed ? 0.6 : 0.8 ) * pupilScale;
	const g = ctx.createLinearGradient( 0, ey - eh, 0, ey + eh );
	g.addColorStop( 0, irisDark );
	g.addColorStop( 0.55, iris );
	g.addColorStop( 1, glazed ? iris : '#ffe4a0' );
	ctx.fillStyle = g;
	ctx.beginPath();
	ctx.ellipse( ex - side * 3, ey + 5, ir, eh * 0.95, 0, 0, Math.PI * 2 );
	ctx.fill();
	// pupil
	ctx.fillStyle = glazed ? 'rgba(40,30,20,0.75)' : '#2b1606';
	ctx.beginPath();
	ctx.ellipse( ex - side * 3, ey + 5, ir * ( glazed ? 0.22 : 0.34 ), eh * ( glazed ? 0.35 : 0.58 ), 0, 0, Math.PI * 2 );
	ctx.fill();
	// highlights
	if ( ! glazed ) {

		ctx.fillStyle = '#ffffff';
		ctx.beginPath();
		ctx.arc( ex - ir * 0.38, ey - eh * 0.38, ir * 0.3, 0, Math.PI * 2 );
		ctx.fill();
		ctx.beginPath();
		ctx.arc( ex + ir * 0.4, ey + eh * 0.4, ir * 0.13, 0, Math.PI * 2 );
		ctx.fill();

	} else {

		// milky film
		ctx.fillStyle = 'rgba(230,225,200,0.35)';
		ctx.fillRect( ex - ew, ey - eh, ew * 2, eh * 2 );

	}

	// upper lid shadow
	const sh = ctx.createLinearGradient( 0, ey - eh, 0, ey - eh * 0.3 );
	sh.addColorStop( 0, 'rgba(60,30,30,0.45)' );
	sh.addColorStop( 1, 'rgba(60,30,30,0)' );
	ctx.fillStyle = sh;
	ctx.fillRect( ex - ew, ey - eh, ew * 2, eh );
	ctx.restore();

	// lashes
	ctx.strokeStyle = lashColor;
	ctx.lineWidth = glazed ? 6 : 9;
	ctx.lineCap = 'round';
	ctx.beginPath();
	ctx.ellipse( ex, ey + 6, ew * 1.1, eh * 1.1, 0, Math.PI * 1.08, Math.PI * 1.92 );
	ctx.stroke();
	ctx.lineWidth = glazed ? 3 : 5;
	ctx.beginPath();
	ctx.moveTo( ex + side * ew * 1.05, ey - eh * 0.45 );
	ctx.lineTo( ex + side * ew * 1.32, ey - eh * 0.72 );
	ctx.stroke();
	ctx.lineWidth = 2.5;
	ctx.beginPath();
	ctx.ellipse( ex, ey - 2, ew * 0.95, eh * 1.0, 0, Math.PI * 0.25, Math.PI * 0.75 );
	ctx.stroke();

}

function brow( ctx, ex, ey, side, angle, color, thick = 4 ) {

	ctx.strokeStyle = color;
	ctx.lineWidth = thick;
	ctx.lineCap = 'round';
	ctx.beginPath();
	const w = S * 0.09, y0 = ey - S * 0.15;
	ctx.moveTo( ex - side * w, y0 + angle * 10 );
	ctx.quadraticCurveTo( ex, y0 - 12 - angle * 6, ex + side * w * 1.1, y0 - 4 - angle * 18 );
	ctx.stroke();

}

export function makeFaceSet( spec ) {

	const faces = {};
	const base = ( draw ) => {

		const c = document.createElement( 'canvas' );
		c.width = c.height = S;
		const ctx = c.getContext( '2d' );
		draw( ctx );
		return tex( c );

	};

	const cx = S / 2, eyeY = S * 0.55, eyeDX = S * 0.21;
	const E = spec.eyes;
	const zombie = spec.face === 'zombie';
	const browCol = zombie ? '#2a211c' : '#7fa38c';

	const mouthY = S * 0.76;
	const nose = ( ctx ) => {

		ctx.strokeStyle = zombie ? 'rgba(40,25,20,0.7)' : 'rgba(180,110,90,0.7)';
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.moveTo( cx + 2, eyeY + S * 0.1 );
		ctx.lineTo( cx - 2, eyeY + S * 0.125 );
		ctx.stroke();

	};

	const blush = ( ctx, strength ) => {

		for ( const side of [ - 1, 1 ] ) {

			const g = ctx.createRadialGradient( cx + side * S * 0.25, eyeY + S * 0.1, 2, cx + side * S * 0.25, eyeY + S * 0.1, S * 0.12 );
			g.addColorStop( 0, `rgba(255,90,110,${0.7 * strength})` );
			g.addColorStop( 1, 'rgba(255,90,110,0)' );
			ctx.fillStyle = g;
			ctx.fillRect( 0, 0, S, S );

		}

	};

	const cheekHollows = ( ctx ) => {

		for ( const side of [ - 1, 1 ] ) {

			const g = ctx.createRadialGradient( cx + side * S * 0.28, eyeY + S * 0.14, 2, cx + side * S * 0.28, eyeY + S * 0.14, S * 0.14 );
			g.addColorStop( 0, 'rgba(40,20,20,0.45)' );
			g.addColorStop( 1, 'rgba(40,20,20,0)' );
			ctx.fillStyle = g;
			ctx.fillRect( 0, 0, S, S );
			// eye sockets
			const g2 = ctx.createRadialGradient( cx + side * eyeDX, eyeY, 4, cx + side * eyeDX, eyeY, S * 0.15 );
			g2.addColorStop( 0, 'rgba(30,15,25,0.5)' );
			g2.addColorStop( 1, 'rgba(30,15,25,0)' );
			ctx.fillStyle = g2;
			ctx.fillRect( 0, 0, S, S );

		}

	};

	const mouth = ( ctx, kind ) => {

		ctx.strokeStyle = zombie ? '#3a1c1c' : '#8a3f3a';
		ctx.lineWidth = 4;
		ctx.lineCap = 'round';
		ctx.beginPath();
		if ( kind === 'smile' ) {

			ctx.moveTo( cx - 14, mouthY );
			ctx.quadraticCurveTo( cx, mouthY + 6, cx + 14, mouthY );

		} else if ( kind === 'wavy' ) {

			ctx.moveTo( cx - 22, mouthY );
			ctx.quadraticCurveTo( cx - 11, mouthY - 9, cx, mouthY );
			ctx.quadraticCurveTo( cx + 11, mouthY + 9, cx + 22, mouthY );

		} else if ( kind === 'grit' ) {

			ctx.moveTo( cx - 18, mouthY );
			ctx.lineTo( cx + 18, mouthY );
			ctx.stroke();
			ctx.fillStyle = '#f2ead8';
			ctx.fillRect( cx - 16, mouthY - 5, 32, 10 );
			ctx.strokeStyle = 'rgba(80,40,40,0.6)';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			for ( let x = cx - 10; x <= cx + 10; x += 5 ) {

				ctx.moveTo( x, mouthY - 5 );
				ctx.lineTo( x, mouthY + 5 );

			}

		} else if ( kind === 'slack' ) {

			ctx.fillStyle = '#1a0c0c';
			ctx.beginPath();
			ctx.ellipse( cx, mouthY + 4, 16, 14, 0, 0, Math.PI * 2 );
			ctx.fill();
			ctx.fillStyle = '#d8cfb4';
			for ( let i = - 2; i <= 2; i ++ ) ctx.fillRect( cx + i * 6 - 2, mouthY - 9, 4, 7 );
			ctx.moveTo( cx - 20, mouthY - 6 );
			ctx.quadraticCurveTo( cx, mouthY - 1, cx + 20, mouthY - 8 );

		} else if ( kind === 'roar' ) {

			ctx.fillStyle = '#2a0d0d';
			ctx.beginPath();
			ctx.ellipse( cx, mouthY + 6, 26, 24, 0, 0, Math.PI * 2 );
			ctx.fill();
			ctx.fillStyle = '#d8cfb4';
			for ( let i = - 3; i <= 3; i ++ ) {

				ctx.beginPath();
				ctx.moveTo( cx + i * 7 - 3, mouthY - 16 );
				ctx.lineTo( cx + i * 7 + 3, mouthY - 16 );
				ctx.lineTo( cx + i * 7, mouthY - 4 );
				ctx.fill();

			}

			ctx.moveTo( cx - 26, mouthY - 8 );
			ctx.quadraticCurveTo( cx, mouthY - 20, cx + 26, mouthY - 8 );

		} else if ( kind === 'ow' ) {

			ctx.moveTo( cx - 10, mouthY + 4 );
			ctx.quadraticCurveTo( cx, mouthY - 10, cx + 10, mouthY + 4 );

		}

		ctx.stroke();

	};

	const eyes = ( ctx, opts ) => {

		for ( const side of [ - 1, 1 ] ) eye( ctx, cx + side * eyeDX, eyeY, side, { iris: E.iris, irisDark: E.irisDark, glazed: E.shape === 'glazed', ...opts } );

	};

	if ( ! zombie ) {

		faces.neutral = base( ( ctx ) => {

			eyes( ctx, {} );
			for ( const side of [ - 1, 1 ] ) brow( ctx, cx + side * eyeDX, eyeY, side, 0, browCol );
			nose( ctx );
			mouth( ctx, 'smile' );

		} );
		faces.blink = base( ( ctx ) => {

			eyes( ctx, { open: 0 } );
			for ( const side of [ - 1, 1 ] ) brow( ctx, cx + side * eyeDX, eyeY, side, 0, browCol );
			nose( ctx );
			mouth( ctx, 'smile' );

		} );
		faces.flustered = base( ( ctx ) => {

			blush( ctx, 1 );
			eyes( ctx, { size: 1.08, pupilScale: 0.75 } );
			for ( const side of [ - 1, 1 ] ) brow( ctx, cx + side * eyeDX, eyeY, side, 1, browCol );
			nose( ctx );
			mouth( ctx, 'wavy' );
			// sweat drop
			ctx.fillStyle = 'rgba(170,220,255,0.9)';
			ctx.beginPath();
			ctx.moveTo( cx + S * 0.33, eyeY - S * 0.2 );
			ctx.quadraticCurveTo( cx + S * 0.36, eyeY - S * 0.13, cx + S * 0.33, eyeY - S * 0.1 );
			ctx.quadraticCurveTo( cx + S * 0.3, eyeY - S * 0.13, cx + S * 0.33, eyeY - S * 0.2 );
			ctx.fill();

		} );
		faces.effort = base( ( ctx ) => {

			eyes( ctx, { open: 0.75 } );
			for ( const side of [ - 1, 1 ] ) brow( ctx, cx + side * eyeDX, eyeY, side, - 1, browCol );
			nose( ctx );
			mouth( ctx, 'grit' );

		} );
		faces.hurt = base( ( ctx ) => {

			eyes( ctx, { open: 0.0 } );
			for ( const side of [ - 1, 1 ] ) brow( ctx, cx + side * eyeDX, eyeY, side, 1.2, browCol );
			nose( ctx );
			mouth( ctx, 'ow' );

		} );

	} else {

		faces.neutral = base( ( ctx ) => {

			cheekHollows( ctx );
			eyes( ctx, { open: 0.8, lashColor: '#1a1210' } );
			for ( const side of [ - 1, 1 ] ) brow( ctx, cx + side * eyeDX, eyeY, side, 0.4, browCol, 5 );
			nose( ctx );
			mouth( ctx, 'slack' );

		} );
		faces.blink = base( ( ctx ) => {

			cheekHollows( ctx );
			eyes( ctx, { open: 0, lashColor: '#1a1210' } );
			nose( ctx );
			mouth( ctx, 'slack' );

		} );
		faces.rage = base( ( ctx ) => {

			cheekHollows( ctx );
			eyes( ctx, { open: 1.1, size: 1.1, lashColor: '#1a1210' } );
			for ( const side of [ - 1, 1 ] ) brow( ctx, cx + side * eyeDX, eyeY, side, - 1.4, browCol, 6 );
			nose( ctx );
			mouth( ctx, 'roar' );

		} );
		faces.hurt = base( ( ctx ) => {

			cheekHollows( ctx );
			eyes( ctx, { open: 0.35, lashColor: '#1a1210' } );
			for ( const side of [ - 1, 1 ] ) brow( ctx, cx + side * eyeDX, eyeY, side, 1, browCol, 5 );
			nose( ctx );
			mouth( ctx, 'roar' );

		} );
		faces.flustered = faces.rage;
		faces.effort = faces.rage;

	}

	return faces;

}
