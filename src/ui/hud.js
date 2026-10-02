const $ = ( id ) => document.getElementById( id );

const CARDINALS = [ [ 0, 'N' ], [ 45, 'NE' ], [ 90, 'E' ], [ 135, 'SE' ], [ 180, 'S' ], [ 225, 'SW' ], [ 270, 'W' ], [ 315, 'NW' ] ];

export class Hud {

	constructor( total, isWebGPU ) {

		this.backendName = isWebGPU ? 'WebGPU' : 'WebGL 2';
		$( 'total' ).textContent = total;
		$( 'backend' ).textContent = this.backendName;
		this.count = $( 'count' );
		this.timer = $( 'timer' );
		this.alt = $( 'alt' );
		this.stamina = $( 'stamina' );
		this.staminaFill = $( 'stamina-fill' );
		this.toastEl = $( 'toast' );
		this.compassTarget = $( 'compass-target' );
		this.targetDist = $( 'target-dist' );
		this.compass = $( 'compass' );
		this.marks = [];
		const strip = $( 'compass-strip' );
		for ( let a = 0; a < 360; a += 15 ) {

			const card = CARDINALS.find( ( c ) => c[ 0 ] === a );
			const el = document.createElement( card ? 'span' : 'i' );
			if ( card ) {

				el.textContent = card[ 1 ];
				if ( a === 0 ) el.className = 'n';

			}

			strip.appendChild( el );
			this.marks.push( { a, el } );

		}

		this.lastSecond = - 1;
		this.toastTimer = 0;
		this.healthFill = $( 'health-fill' );
		this.health = $( 'health' );
		this.kills = $( 'kills' );
		this.damageVignette = $( 'damage' );
		this.lastHp = 100;

	}

	formatTime( t ) {

		const m = Math.floor( t / 60 ), s = Math.floor( t % 60 );
		return `${m}:${s.toString().padStart( 2, '0' )}`;

	}

	setFps( fps ) {

		$( 'backend' ).textContent = `${this.backendName} · ${Math.round( fps )} fps`;

	}

	hintLater() {

		setTimeout( () => $( 'hint' ).classList.add( 'fade' ), 14000 );

	}

	toast( text, gold = false ) {

		const el = this.toastEl;
		el.textContent = text;
		el.classList.toggle( 'gold', gold );
		el.classList.add( 'show' );
		clearTimeout( this.toastTimer );
		this.toastTimer = setTimeout( () => el.classList.remove( 'show' ), 2200 );

	}

	collect( n, golden ) {

		this.count.textContent = n;
		const c = this.count.parentElement;
		c.classList.remove( 'bump' );
		void c.offsetWidth;
		c.classList.add( 'bump' );
		const lines = [ 'Pocky get!', 'Crunchy!', 'Mrrp! Another one', 'Chocolate acquired', 'Nom.', 'Snack secured' ];
		this.toast( golden ? '✨ The Golden Pocky! ✨' : lines[ n % lines.length ], golden );

	}

	setHealth( hp, maxHp, threat ) {

		const f = Math.max( 0, hp / maxHp );
		this.healthFill.style.width = ( f * 100 ).toFixed( 1 ) + '%';
		this.health.classList.toggle( 'low', f < 0.3 );
		this.health.classList.toggle( 'threat', threat );
		if ( hp < this.lastHp - 0.5 ) {

			this.damageVignette.style.opacity = 1;
			this.health.classList.remove( 'shake' );
			void this.health.offsetWidth;
			this.health.classList.add( 'shake' );

		}

		this.lastHp = hp;
		const op = parseFloat( this.damageVignette.style.opacity || 0 );
		if ( op > 0 ) this.damageVignette.style.opacity = Math.max( 0, op - 0.03 ) + ( f < 0.3 ? 0.25 : 0 );

	}

	setKills( n ) {

		this.kills.textContent = n;

	}

	update( { time, altitude, stamina, climbing, camera, target, playerPos } ) {

		const sec = Math.floor( time );
		if ( sec !== this.lastSecond ) {

			this.lastSecond = sec;
			this.timer.textContent = this.formatTime( time );

		}

		this.alt.textContent = Math.max( 0, altitude ).toFixed( 0 );

		const show = climbing || stamina < 0.99;
		this.stamina.classList.toggle( 'show', show );
		this.stamina.classList.toggle( 'low', stamina < 0.25 );
		this.staminaFill.style.width = ( stamina * 100 ).toFixed( 1 ) + '%';

		// compass: heading 0 = north (-Z), 90 = east (+X)
		const e = camera.matrixWorld.elements;
		const fx = - e[ 8 ], fz = - e[ 10 ];
		const heading = ( Math.atan2( fx, - fz ) * 180 / Math.PI + 360 ) % 360;
		const w = this.compass.clientWidth;
		const pxPerDeg = w / 180;
		for ( const m of this.marks ) {

			const off = ( ( m.a - heading + 540 ) % 360 ) - 180;
			m.el.style.left = ( w / 2 + off * pxPerDeg ) + 'px';
			m.el.style.display = Math.abs( off ) > 95 ? 'none' : '';

		}

		if ( target ) {

			const p = target.item.group.position;
			const bearing = ( Math.atan2( p.x - playerPos.x, - ( p.z - playerPos.z ) ) * 180 / Math.PI + 360 ) % 360;
			let off = ( ( bearing - heading + 540 ) % 360 ) - 180;
			off = Math.max( - 84, Math.min( 84, off ) );
			this.compassTarget.style.left = ( w / 2 + off * pxPerDeg ) + 'px';
			this.compassTarget.style.display = '';
			this.compassTarget.classList.toggle( 'gold', target.item.golden );
			const dy = p.y - playerPos.y;
			this.targetDist.textContent = `${Math.round( target.dist )} m${dy > 4 ? ' ↑' : dy < - 4 ? ' ↓' : ''}`;

		} else {

			this.compassTarget.style.display = 'none';

		}

	}

}
