import { defineConfig } from 'vite';

export default defineConfig( {
	build: {
		target: 'es2022',
		chunkSizeWarningLimit: 2000,
		rollupOptions: { input: { main: 'index.html', viewer: 'viewer.html' } },
	},
} );
