use fate_api::prelude::*;
use steel::*;

pub fn prepare_weight_path<'info>(
    program_id: &Pubkey,
    payer: &AccountInfo<'info>,
    system_program_info: &AccountInfo<'info>,
    tree: &AccountInfo<'info>,
    leaf_index: u64,
    pages: &[AccountInfo<'info>],
) -> ProgramResult {
    if pages.len() != WEIGHT_TREE_DEPTH {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    for (level, page_info) in pages.iter().enumerate() {
        let prefix = weight_prefix(leaf_index, level);
        let level_bytes = (level as u64).to_le_bytes();
        let prefix_bytes = prefix.to_le_bytes();
        let seeds = [
            WEIGHT_PAGE_SEED,
            tree.key.as_ref(),
            &level_bytes,
            &prefix_bytes,
        ];
        page_info.is_writable()?.has_seeds(&seeds, program_id)?;
        if page_info.data_is_empty() {
            page_info.has_owner(&system_program::ID)?;
            create_program_account::<WeightPage>(
                page_info,
                system_program_info,
                payer,
                program_id,
                &seeds,
            )?;
            let page = page_info.as_account_mut::<WeightPage>(program_id)?;
            page.tree = *tree.key;
            page.rent_payer = *payer.key;
            page.level = level as u64;
            page.prefix = prefix;
        } else {
            validate_page(
                page_info.as_account::<WeightPage>(program_id)?,
                tree.key,
                leaf_index,
                level,
            )?;
        }
    }
    Ok(())
}

pub fn update_weight_path(
    program_id: &Pubkey,
    tree: &Pubkey,
    leaf_index: u64,
    old_weight: u128,
    new_weight: u128,
    pages: &[AccountInfo<'_>],
) -> ProgramResult {
    if pages.len() != WEIGHT_TREE_DEPTH {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let snapshots = pages
        .iter()
        .enumerate()
        .map(|(level, info)| {
            let page = *info.as_account::<WeightPage>(program_id)?;
            validate_page(&page, tree, leaf_index, level)?;
            validate_page_address(info, program_id, tree, leaf_index, level)?;
            Ok(page)
        })
        .collect::<Result<Vec<_>, ProgramError>>()?;

    let leaf = &snapshots[WEIGHT_TREE_DEPTH - 1];
    if leaf.weights[weight_branch(leaf_index, WEIGHT_TREE_DEPTH - 1)].get() != old_weight {
        return Err(FateError::InvalidWeightTree.into());
    }
    for level in 0..WEIGHT_TREE_DEPTH - 1 {
        let branch = weight_branch(leaf_index, level);
        if snapshots[level].weights[branch].get() != snapshots[level + 1].total()? {
            return Err(FateError::InvalidWeightTree.into());
        }
    }

    for (level, info) in pages.iter().enumerate() {
        let page = info.as_account_mut::<WeightPage>(program_id)?;
        let branch = weight_branch(leaf_index, level);
        if new_weight >= old_weight {
            page.add(branch, new_weight - old_weight)?;
        } else {
            page.subtract(branch, old_weight - new_weight)?;
        }
    }
    Ok(())
}

#[cfg(feature = "dev-randomness")]
pub fn select_weight_path(
    program_id: &Pubkey,
    tree: &Pubkey,
    target: u128,
    pages: &[AccountInfo<'_>],
) -> Result<u64, ProgramError> {
    let snapshots = pages
        .iter()
        .map(|info| Ok(*info.as_account::<WeightPage>(program_id)?))
        .collect::<Result<Vec<_>, ProgramError>>()?;
    let index = select_weighted_index(&snapshots, tree, target)?;
    for (level, info) in pages.iter().enumerate() {
        validate_page_address(info, program_id, tree, index, level)?;
    }
    for level in 0..WEIGHT_TREE_DEPTH - 1 {
        let branch = weight_branch(index, level);
        if snapshots[level].weights[branch].get() != snapshots[level + 1].total()? {
            return Err(FateError::InvalidWeightTree.into());
        }
    }
    Ok(index)
}

fn validate_page_address(
    info: &AccountInfo<'_>,
    program_id: &Pubkey,
    tree: &Pubkey,
    index: u64,
    level: usize,
) -> ProgramResult {
    let level_bytes = (level as u64).to_le_bytes();
    let prefix_bytes = weight_prefix(index, level).to_le_bytes();
    info.has_seeds(
        &[WEIGHT_PAGE_SEED, tree.as_ref(), &level_bytes, &prefix_bytes],
        program_id,
    )?;
    Ok(())
}

fn validate_page(page: &WeightPage, tree: &Pubkey, index: u64, level: usize) -> ProgramResult {
    if page.tree != *tree
        || page.level != level as u64
        || page.prefix != weight_prefix(index, level)
    {
        return Err(FateError::InvalidWeightTree.into());
    }
    Ok(())
}
