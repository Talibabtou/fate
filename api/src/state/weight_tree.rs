use steel::*;

use crate::{
    consts::{WEIGHT_PAGE_WIDTH, WEIGHT_TREE_DEPTH},
    error::FateError,
};

use super::{FateAccount, U128Value};

#[repr(C)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Pod, Zeroable)]
pub struct WeightPage {
    pub tree: Pubkey,
    pub rent_payer: Pubkey,
    pub level: u64,
    pub prefix: u64,
    pub weights: [U128Value; WEIGHT_PAGE_WIDTH],
}

impl WeightPage {
    pub fn total(&self) -> Result<u128, FateError> {
        self.weights.iter().try_fold(0u128, |total, weight| {
            total
                .checked_add(weight.get())
                .ok_or(FateError::ArithmeticOverflow)
        })
    }

    pub fn add(&mut self, branch: usize, delta: u128) -> Result<(), FateError> {
        let value = self.weights[branch]
            .get()
            .checked_add(delta)
            .ok_or(FateError::ArithmeticOverflow)?;
        self.weights[branch] = U128Value::new(value);
        Ok(())
    }

    pub fn subtract(&mut self, branch: usize, delta: u128) -> Result<(), FateError> {
        let value = self.weights[branch]
            .get()
            .checked_sub(delta)
            .ok_or(FateError::InvalidWeightTree)?;
        self.weights[branch] = U128Value::new(value);
        Ok(())
    }

    pub fn select(&self, target: u128) -> Result<(usize, u128), FateError> {
        let mut skipped = 0u128;
        for (branch, weight) in self.weights.iter().enumerate() {
            let end = skipped
                .checked_add(weight.get())
                .ok_or(FateError::ArithmeticOverflow)?;
            if target < end {
                return Ok((branch, target - skipped));
            }
            skipped = end;
        }
        Err(FateError::SelectionOutOfRange)
    }
}

account!(FateAccount, WeightPage);

pub const fn weight_branch(index: u64, level: usize) -> usize {
    ((index >> ((WEIGHT_TREE_DEPTH - 1 - level) * 4)) & 0x0f) as usize
}

pub const fn weight_prefix(index: u64, level: usize) -> u64 {
    if level == 0 {
        0
    } else {
        let remaining_bits = (WEIGHT_TREE_DEPTH - level) * 4;
        (index >> remaining_bits) << remaining_bits
    }
}

pub fn validate_weight_path(
    pages: &[WeightPage],
    tree: &Pubkey,
    index: u64,
) -> Result<(), FateError> {
    if pages.len() != WEIGHT_TREE_DEPTH {
        return Err(FateError::InvalidWeightTree);
    }
    for (level, page) in pages.iter().enumerate() {
        if page.tree != *tree
            || page.level != level as u64
            || page.prefix != weight_prefix(index, level)
        {
            return Err(FateError::InvalidWeightTree);
        }
    }
    Ok(())
}

pub fn select_weighted_index(
    pages: &[WeightPage],
    tree: &Pubkey,
    mut target: u128,
) -> Result<u64, FateError> {
    if pages.len() != WEIGHT_TREE_DEPTH {
        return Err(FateError::InvalidWeightTree);
    }
    let mut index = 0u64;
    for (level, page) in pages.iter().enumerate() {
        if page.tree != *tree
            || page.level != level as u64
            || page.prefix != weight_prefix(index, level)
        {
            return Err(FateError::InvalidWeightTree);
        }
        let (branch, remainder) = page.select(target)?;
        index |= (branch as u64) << ((WEIGHT_TREE_DEPTH - 1 - level) * 4);
        target = remainder;
    }
    Ok(index)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path(tree: Pubkey, index: u64, leaf_weight: u128) -> Vec<WeightPage> {
        (0..WEIGHT_TREE_DEPTH)
            .map(|level| {
                let mut page = WeightPage {
                    tree,
                    level: level as u64,
                    prefix: weight_prefix(index, level),
                    ..WeightPage::zeroed()
                };
                page.weights[weight_branch(index, level)] = U128Value::new(leaf_weight);
                page
            })
            .collect()
    }

    #[test]
    fn full_index_namespace_round_trips_through_a_path() {
        let tree = Pubkey::new_unique();
        let index = 0xfedc_ba98;
        let pages = path(tree, index, 42);
        assert_eq!(validate_weight_path(&pages, &tree, index), Ok(()));
        assert_eq!(select_weighted_index(&pages, &tree, 41), Ok(index));
    }

    #[test]
    fn page_selection_skips_empty_and_prior_branches() {
        let mut page = WeightPage::zeroed();
        page.weights[2] = U128Value::new(10);
        page.weights[7] = U128Value::new(20);
        assert_eq!(page.select(0), Ok((2, 0)));
        assert_eq!(page.select(9), Ok((2, 9)));
        assert_eq!(page.select(10), Ok((7, 0)));
        assert_eq!(page.select(29), Ok((7, 19)));
        assert_eq!(page.select(30), Err(FateError::SelectionOutOfRange));
    }

    #[test]
    fn account_size_is_stable() {
        assert_eq!(WeightPage::SIZE, 344);
    }

    #[test]
    fn weighted_path_property_fuzz_covers_namespace_and_metadata_mutations() {
        let tree = Pubkey::new_unique();
        let mut state = 0xFA7E_2026_5EED_u64;
        for _ in 0..2_048 {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1);
            let index = state & u64::from(u32::MAX);
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1);
            let weight = u128::from(1 + state % 1_000_000);
            let pages = path(tree, index, weight);

            assert_eq!(validate_weight_path(&pages, &tree, index), Ok(()));
            assert_eq!(select_weighted_index(&pages, &tree, weight - 1), Ok(index));
            assert_eq!(
                select_weighted_index(&pages, &tree, weight),
                Err(FateError::SelectionOutOfRange)
            );

            let mut wrong_tree = pages.clone();
            wrong_tree[(state as usize) % WEIGHT_TREE_DEPTH].tree = Pubkey::new_unique();
            assert_eq!(
                validate_weight_path(&wrong_tree, &tree, index),
                Err(FateError::InvalidWeightTree)
            );

            let mut wrong_level = pages.clone();
            let level = (state as usize) % WEIGHT_TREE_DEPTH;
            wrong_level[level].level = wrong_level[level].level.wrapping_add(1);
            assert_eq!(
                validate_weight_path(&wrong_level, &tree, index),
                Err(FateError::InvalidWeightTree)
            );

            let mut wrong_prefix = pages;
            let level = (state as usize) % WEIGHT_TREE_DEPTH;
            wrong_prefix[level].prefix ^= 1;
            assert_eq!(
                validate_weight_path(&wrong_prefix, &tree, index),
                Err(FateError::InvalidWeightTree)
            );
        }
    }
}
