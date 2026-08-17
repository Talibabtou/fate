pub mod consts;
pub mod error;
pub mod math;
pub mod state;

pub mod prelude {
    pub use crate::consts::*;
    pub use crate::error::*;
    pub use crate::math::*;
    pub use crate::state::*;
}
