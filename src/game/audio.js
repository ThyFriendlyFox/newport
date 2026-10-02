// Tiny WebAudio synth for game feedback — no audio files needed.
export class Sfx {

	constructor() {

		this.ctx = null;
		this.muted = false;

	}

	unlock() {

		if ( this.ctx ) return;
		try {

			this.ctx = new AudioContext();
			this.master = this.ctx.createGain();
			this.master.gain.value = 0.35;
			this.master.connect( this.ctx.destination );
			this.startAmbience();

		} catch {

			this.ctx = null;

		}

	}

	tone( freq, dur, { type = 'sine', gain = 0.3, slide = 0, delay = 0 } = {} ) {

		if ( ! this.ctx || this.muted ) return;
		const t = this.ctx.currentTime + delay;
		const o = this.ctx.createOscillator();
		const g = this.ctx.createGain();
		o.type = type;
		o.frequency.setValueAtTime( freq, t );
		if ( slide ) o.frequency.exponentialRampToValueAtTime( Math.max( 20, freq * slide ), t + dur );
		g.gain.setValueAtTime( 0, t );
		g.gain.linearRampToValueAtTime( gain, t + 0.01 );
		g.gain.exponentialRampToValueAtTime( 0.0001, t + dur );
		o.connect( g ).connect( this.master );
		o.start( t );
		o.stop( t + dur + 0.05 );

	}

	noise( dur, { gain = 0.2, freq = 1200, q = 0.8 } = {} ) {

		if ( ! this.ctx || this.muted ) return;
		const n = Math.floor( this.ctx.sampleRate * dur );
		const buf = this.ctx.createBuffer( 1, n, this.ctx.sampleRate );
		const d = buf.getChannelData( 0 );
		for ( let i = 0; i < n; i ++ ) d[ i ] = ( Math.random() * 2 - 1 ) * ( 1 - i / n );
		const src = this.ctx.createBufferSource();
		src.buffer = buf;
		const f = this.ctx.createBiquadFilter();
		f.type = 'bandpass';
		f.frequency.value = freq;
		f.Q.value = q;
		const g = this.ctx.createGain();
		g.gain.value = gain;
		src.connect( f ).connect( g ).connect( this.master );
		src.start();

	}

	growl( dur, freq ) {

		if ( ! this.ctx || this.muted ) return;
		const t = this.ctx.currentTime;
		const o = this.ctx.createOscillator();
		const o2 = this.ctx.createOscillator();
		const g = this.ctx.createGain();
		const f = this.ctx.createBiquadFilter();
		o.type = 'sawtooth';
		o2.type = 'square';
		o.frequency.setValueAtTime( freq, t );
		o.frequency.linearRampToValueAtTime( freq * 0.7, t + dur );
		o2.frequency.setValueAtTime( freq * 1.51, t );
		f.type = 'lowpass';
		f.frequency.setValueAtTime( 400, t );
		f.frequency.linearRampToValueAtTime( 900, t + dur * 0.4 );
		f.frequency.linearRampToValueAtTime( 300, t + dur );
		g.gain.setValueAtTime( 0, t );
		g.gain.linearRampToValueAtTime( 0.12, t + 0.05 );
		g.gain.linearRampToValueAtTime( 0.0001, t + dur );
		o.connect( f );
		o2.connect( f );
		f.connect( g ).connect( this.master );
		o.start( t );
		o2.start( t );
		o.stop( t + dur );
		o2.stop( t + dur );

	}

	startAmbience() {

		// soft city hum + wind
		const n = this.ctx.sampleRate * 4;
		const buf = this.ctx.createBuffer( 1, n, this.ctx.sampleRate );
		const d = buf.getChannelData( 0 );
		let last = 0;
		for ( let i = 0; i < n; i ++ ) {

			last = last * 0.985 + ( Math.random() * 2 - 1 ) * 0.015;
			d[ i ] = last * 3;

		}

		const src = this.ctx.createBufferSource();
		src.buffer = buf;
		src.loop = true;
		this.wind = this.ctx.createGain();
		this.wind.gain.value = 0.12;
		src.connect( this.wind ).connect( this.master );
		src.start();

	}

	setAltitude( h ) {

		if ( this.wind ) this.wind.gain.value = 0.1 + Math.min( 1, Math.max( 0, h / 80 ) ) * 0.5;

	}

	play( name ) {

		switch ( name ) {

			case 'jump': this.tone( 420, 0.14, { type: 'triangle', gain: 0.12, slide: 1.6 } ); break;
			case 'double': this.tone( 560, 0.18, { type: 'triangle', gain: 0.12, slide: 1.8 } ); this.noise( 0.15, { gain: 0.08, freq: 2500 } ); break;
			case 'walljump': this.tone( 500, 0.15, { type: 'square', gain: 0.05, slide: 1.5 } ); break;
			case 'land': this.noise( 0.12, { gain: 0.25, freq: 300 } ); break;
			case 'grab': this.noise( 0.06, { gain: 0.15, freq: 1800 } ); break;
			case 'mantle': this.tone( 330, 0.1, { type: 'triangle', gain: 0.08, slide: 1.3 } ); break;
			case 'splash': this.noise( 0.4, { gain: 0.3, freq: 900, q: 0.4 } ); break;
			case 'pigeons': for ( let i = 0; i < 6; i ++ ) this.noise( 0.05, { gain: 0.12, freq: 1400 + i * 120 } ); break;
			case 'pocky':
				[ 784, 988, 1175, 1568 ].forEach( ( f, i ) => this.tone( f, 0.25, { type: 'triangle', gain: 0.12, delay: i * 0.06 } ) );
				break;
			case 'kick': this.noise( 0.09, { gain: 0.22, freq: 700, q: 0.6 } ); this.tone( 180, 0.12, { type: 'triangle', gain: 0.1, slide: 0.5 } ); break;
			case 'kickHit': this.noise( 0.16, { gain: 0.45, freq: 350, q: 0.5 } ); this.tone( 90, 0.2, { type: 'square', gain: 0.12, slide: 0.4 } ); break;
			case 'kill': this.noise( 0.35, { gain: 0.4, freq: 220, q: 0.3 } ); this.tone( 70, 0.5, { type: 'sawtooth', gain: 0.1, slide: 0.3 } ); break;
			case 'hurt': this.tone( 300, 0.25, { type: 'sawtooth', gain: 0.12, slide: 0.45 } ); this.noise( 0.2, { gain: 0.3, freq: 500 } ); break;
			case 'die': [ 330, 262, 196, 131 ].forEach( ( f, i ) => this.tone( f, 0.5, { type: 'triangle', gain: 0.14, delay: i * 0.18 } ) ); break;
			case 'revive': [ 392, 523, 659 ].forEach( ( f, i ) => this.tone( f, 0.3, { type: 'triangle', gain: 0.1, delay: i * 0.1 } ) ); break;
			case 'growl': this.growl( 0.6, 55 + Math.random() * 30 ); break;
			case 'zombieAttack': this.growl( 0.35, 120 + Math.random() * 40 ); this.noise( 0.25, { gain: 0.25, freq: 900, q: 0.4 } ); break;
			case 'golden':
				[ 523, 659, 784, 1047, 1319, 1568, 2093 ].forEach( ( f, i ) => this.tone( f, 0.5, { type: 'triangle', gain: 0.12, delay: i * 0.08 } ) );
				break;
			default: break;

		}

	}

}
