# Physics

Open **Physics** in the Project panel to choose what kind of game this is and how it moves. A pixel ball in the tab moves with the current numbers as you drag them. It runs the same integer steps as the game. Click it to play it yourself with the arrow keys and Space.

The settings are saved under `physics` in `studio/project.json`, and undo works as it does in other documents.

## Game type

| Type | For |
| --- | --- |
| **2D platformer** | Side-on games with gravity and jumping. This is the default. |
| **Top-down** | Games seen from above, with no gravity. Movement is either free, as in action adventures, or one grid step at a time, as in tile-based RPGs. |

## 2D platformer

Speeds are in 1/256 of a pixel per frame, at 60 frames a second. The value beside each slider gives the same number in pixels per frame (`px/f`). An acceleration of 0 means instant.

| Setting | Meaning |
| --- | --- |
| **Gravity: rising, falling** | Pull while going up and while coming down. A higher falling value makes jumps land sooner. |
| **Top fall speed** | The fastest a fall gets. |
| **Run speed** | Speed along the ground and through the air. |
| **Acceleration, friction** | How quickly running starts and stops on the ground. |
| **Air control** | How quickly direction changes in the air. |
| **Jump speed** | Upward speed at the start of a jump. |
| **Short hop cap** | Letting go of jump limits the rise to this speed. As high as the jump speed or more, every jump is a full one. |
| **Air jumps** | Extra jumps before landing. |
| **Coyote time** | How long after leaving a ledge a jump still works. |
| **Jump buffer** | How long a jump pressed too early is remembered until landing. |

The tab also shows what these come to: jump height, short hop, time in the air and the length of a running jump.

## Top-down

| Setting | Meaning |
| --- | --- |
| **Style** | **Free** moves by the pixel. **Grid** moves one whole step at a time and always finishes it. |
| **Speed** | Walking speed. |
| **Step size** | Grid only: 8 or 16 pixels. Place the player start so the character lines up with the grid. |
| **Directions** | Free only: 4 or 8. With 4, the direction pressed last wins. |
| **Acceleration, friction** | Free only: how quickly walking starts and stops. |
| **Corner slide** | Free only: how far a character is nudged around a corner it just clips. |
| **Diagonals** | Free only: keeps diagonal walking as fast as straight walking. |

Only cells of kind `solid` stop a character seen from above. Hazards work as they do in a platformer.

## In the game's code

The build gives the game these numbers as `data::PHYSICS`, so a change needs a rebuild to reach the ROM. The runtime's controllers apply them:

```rust
use pecten_studio_rt::physics::{PlatformerController, PlatformerInput};

let mut control = PlatformerController::new();
// every frame:
let buttons = PlatformerInput { direction, jump_pressed, jump_held };
let jumped = control.update(&mut body, &data::PHYSICS.platformer, buttons);
body.step(&data::WORLD, drop_through);
```

```rust
use pecten_studio_rt::physics::TopDownController;

let walls = data::WORLD.enclosed(); // the edges of the map are walls
let mut control = TopDownController::new();
// every frame, with dx and dy of -1, 0 or 1:
control.update(&mut body, &walls, &data::PHYSICS.top_down, dx, dy);
```

The sample game uses both and picks one from `data::PHYSICS.mode`. The starter code of a new game only shows its first room, so it ignores these settings until it has a player.
