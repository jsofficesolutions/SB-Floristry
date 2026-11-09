/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        obsidian: '#080808',
        noir: '#0D0D0D',
        'dark-surface': '#121212',
        'dark-card': '#161616',
        'dark-card-hover': '#1E1E1E',
        gold: {
          DEFAULT: '#D4AF37',
          light: '#F4E4BC',
          champagne: '#E5C378',
          muted: '#B89742',
          deep: '#8E7026'
        },
        cream: '#FAF8F5',
        ivory: '#F3EFE8',
        stone: {
          DEFAULT: '#9E988F',
          muted: '#6B665F'
        },
        // Legacy palette mappings for seamless compatibility
        'sb-black': '#080808',
        'sb-gold': '#D4AF37',
        'sb-cream': '#FAF8F5',
        'sb-dark': '#121212',
        bone: '#080808',
        paper: '#121212',
        ink: '#FAF8F5'
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', '"Playfair Display"', 'Georgia', 'serif'],
        serif: ['"Cormorant Garamond"', '"Playfair Display"', 'Georgia', 'serif'],
        body: ['"Inter"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        sans: ['"Inter"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif']
      },
      fontSize: {
        'fluid-xs': 'clamp(0.75rem, 0.7rem + 0.25vw, 0.875rem)',
        'fluid-sm': 'clamp(0.875rem, 0.8rem + 0.35vw, 1rem)',
        'fluid-base': 'clamp(1rem, 0.95rem + 0.25vw, 1.125rem)',
        'fluid-lg': 'clamp(1.25rem, 1.15rem + 0.5vw, 1.5rem)',
        'fluid-xl': 'clamp(1.5rem, 1.35rem + 0.75vw, 2rem)',
        'fluid-2xl': 'clamp(2rem, 1.7rem + 1.5vw, 3rem)',
        'fluid-3xl': 'clamp(2.75rem, 2.2rem + 2.75vw, 4.5rem)',
        'fluid-hero': 'clamp(3.5rem, 2.75rem + 3.75vw, 6.25rem)'
      },
      letterSpacing: {
        'caption': '0.18em',
        'editorial': '0.12em',
        'luxury': '0.25em',
        'super-wide': '0.35em'
      },
      spacing: {
        '18': '4.5rem',
        '28': '7rem',
        '36': '9rem',
        'section-sm': 'clamp(3.5rem, 6vw, 5rem)',
        'section-md': 'clamp(5rem, 10vw, 8rem)',
        'section-lg': 'clamp(7rem, 14vw, 12rem)'
      },
      animation: { 
        'fade-in-up': 'fadeInUp 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards', 
        'fade-in': 'fadeIn 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'slow-zoom': 'slowZoom 25s infinite alternate ease-in-out'
      },
      keyframes: {
        fadeInUp: { 
          '0%': { opacity: '0', transform: 'translateY(24px)' }, 
          '100%': { opacity: '1', transform: 'translateY(0)' } 
        },
        fadeIn: { 
          '0%': { opacity: '0' }, 
          '100%': { opacity: '1' } 
        },
        slowZoom: {
          '0%': { transform: 'scale(1)' },
          '100%': { transform: 'scale(1.06)' }
        }
      }
    },
  },
  plugins: [],
}
