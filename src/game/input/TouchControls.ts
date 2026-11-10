import type { Vec2 } from '../logic/Types';

/**
 * On-screen controls for touch screens: a joystick (bottom left) to steer,
 * and SPLIT / SURRENDER buttons (bottom right). They're plain page elements
 * laid over the game, shown only on devices with a touch screen (CSS
 * `any-pointer: coarse`), so desktop players never see them.
 */

const STYLE_ID = 'raidkin-touch-style';
/** How far (CSS px) the stick travels from the centre at full tilt. */
const STICK_TRAVEL = 43;

const CSS = `
.rk-touch { display: none; }
@media (any-pointer: coarse) { .rk-touch { display: block; } }
.rk-joystick {
    position: fixed; left: 24px; bottom: 24px; width: 116px; height: 116px; border-radius: 50%;
    background: #18382466; border: 3px solid #e8f5d788; touch-action: none; z-index: 10;
}
.rk-joystick::before { content: ''; position: absolute; inset: -20px; border-radius: 50%; }
.rk-stick {
    position: absolute; left: 35px; top: 35px; width: 40px; height: 40px; border-radius: 50%;
    background: #f2df9bcc; border: 2px solid #fff9; pointer-events: none;
}
.rk-button {
    position: fixed; right: 22px; width: 84px; height: 84px; border-radius: 50%;
    border: 3px solid #fff5; box-shadow: 0 4px 15px #0005; z-index: 10; touch-action: none;
    font: 900 13px system-ui, sans-serif; color: #2b1c08; padding: 0;
}
.rk-split { bottom: 120px; background: #e6ad44e8; }
.rk-surrender { bottom: 24px; background: #c9d1c6e0; font-size: 11px; }
`;

export class TouchControls
{
    /** Joystick direction, each axis -1..1 (zero while not touched). */
    readonly direction: Vec2 = { x: 0, y: 0 };
    private touchId: number | null = null;
    private splitPressed = false;
    private surrenderPressed = false;
    private readonly elements: HTMLElement[] = [];
    private readonly joystick: HTMLElement;
    private readonly stick: HTMLElement;

    constructor (parent: HTMLElement)
    {
        if (!document.getElementById(STYLE_ID))
        {
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = CSS;
            document.head.appendChild(style);
        }

        this.joystick = document.createElement('div');
        this.joystick.className = 'rk-touch rk-joystick';
        this.stick = document.createElement('div');
        this.stick.className = 'rk-stick';
        this.joystick.appendChild(this.stick);

        const split = this.button('SPLIT', 'rk-split', () => { this.splitPressed = true; });
        const surrender = this.button('SURRENDER', 'rk-surrender', () => { this.surrenderPressed = true; });

        this.joystick.addEventListener('pointerdown', (e) => {
            if (this.touchId !== null) return;
            e.preventDefault();
            this.touchId = e.pointerId;
            try { this.joystick.setPointerCapture(e.pointerId); }
            catch { /* the finger already lifted: carry on without capture */ }
            this.moveStick(e);
        });
        this.joystick.addEventListener('pointermove', (e) => { if (e.pointerId === this.touchId) { e.preventDefault(); this.moveStick(e); } });
        const stop = (e: PointerEvent) => { if (e.pointerId === this.touchId) this.release(); };
        this.joystick.addEventListener('pointerup', stop);
        this.joystick.addEventListener('pointercancel', stop);

        for (const el of [this.joystick, split, surrender])
        {
            parent.appendChild(el);
            this.elements.push(el);
        }
    }

    /** True while a finger is on the joystick. */
    get active (): boolean
    {
        return this.touchId !== null;
    }

    /** True once per tap of SPLIT. */
    consumeSplit (): boolean
    {
        const pressed = this.splitPressed;
        this.splitPressed = false;
        return pressed;
    }

    /** True once per tap of SURRENDER. */
    consumeSurrender (): boolean
    {
        const pressed = this.surrenderPressed;
        this.surrenderPressed = false;
        return pressed;
    }

    destroy (): void
    {
        for (const el of this.elements) el.remove();
        this.elements.length = 0;
    }

    private button (label: string, className: string, onPress: () => void): HTMLButtonElement
    {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `rk-touch rk-button ${className}`;
        button.textContent = label;
        // React the moment it's touched: phones often send no click for a second
        // finger while the first one is steering with the joystick.
        button.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); onPress(); });
        // A click with no pointer behind it comes from the keyboard or a screen reader.
        button.addEventListener('click', (e) => { e.preventDefault(); if (e.detail === 0) onPress(); });
        return button;
    }

    private moveStick (e: PointerEvent): void
    {
        const r = this.joystick.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const length = Math.hypot(dx, dy);
        const scale = length > 0 ? 1 / Math.max(length, STICK_TRAVEL) : 0;
        this.direction.x = dx * scale;
        this.direction.y = dy * scale;
        this.stick.style.transform = `translate(${this.direction.x * STICK_TRAVEL}px, ${this.direction.y * STICK_TRAVEL}px)`;
    }

    private release (): void
    {
        this.touchId = null;
        this.direction.x = 0;
        this.direction.y = 0;
        this.stick.style.transform = 'translate(0, 0)';
    }
}
