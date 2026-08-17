use steel::*;

use super::FateAccount;

pub const RECENT_DRAW_CAPACITY: usize = 10;

#[repr(C)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Pod, Zeroable)]
pub struct Config {
    pub authority: Pubkey,
    pub fee_treasury: Pubkey,
    pub entropy_program: Pubkey,
    pub entropy_variable: Pubkey,
    pub version: u64,
    pub paused: u64,
    pub current_draw_id: u64,
    pub recent_draw_count: u64,
    pub recent_draw_cursor: u64,
    pub recent_draw_ids: [u64; RECENT_DRAW_CAPACITY],
}

impl Config {
    pub fn is_paused(&self) -> bool {
        self.paused != 0
    }

    pub fn push_recent_draw(&mut self, draw_id: u64) {
        let cursor = self.recent_draw_cursor as usize % RECENT_DRAW_CAPACITY;
        self.recent_draw_ids[cursor] = draw_id;
        self.recent_draw_cursor = ((cursor + 1) % RECENT_DRAW_CAPACITY) as u64;
        if self.recent_draw_count < RECENT_DRAW_CAPACITY as u64 {
            self.recent_draw_count += 1;
        }
    }

    pub fn recent_draws_newest_first(&self) -> [u64; RECENT_DRAW_CAPACITY] {
        let mut draws = [0; RECENT_DRAW_CAPACITY];
        let count = self.recent_draw_count.min(RECENT_DRAW_CAPACITY as u64) as usize;
        for (output_index, draw) in draws.iter_mut().take(count).enumerate() {
            let source_index =
                (self.recent_draw_cursor as usize + RECENT_DRAW_CAPACITY - 1 - output_index)
                    % RECENT_DRAW_CAPACITY;
            *draw = self.recent_draw_ids[source_index];
        }
        draws
    }

    pub fn contains_recent_draw(&self, draw_id: u64) -> bool {
        let count = self.recent_draw_count.min(RECENT_DRAW_CAPACITY as u64) as usize;
        self.recent_draws_newest_first()[..count].contains(&draw_id)
    }
}

account!(FateAccount, Config);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recent_draw_ring_keeps_the_latest_ten() {
        let mut config = Config::zeroed();
        for draw_id in 1..=12 {
            config.push_recent_draw(draw_id);
        }

        assert_eq!(config.recent_draw_count, 10);
        assert_eq!(
            config.recent_draws_newest_first(),
            [12, 11, 10, 9, 8, 7, 6, 5, 4, 3]
        );
    }

    #[test]
    fn account_size_is_stable() {
        assert_eq!(Config::SIZE, 256);
    }

    #[test]
    fn recent_draw_membership_ignores_unused_slots() {
        let mut config = Config::zeroed();
        assert!(!config.contains_recent_draw(0));
        config.push_recent_draw(0);
        assert!(config.contains_recent_draw(0));
        assert!(!config.contains_recent_draw(1));
    }
}
