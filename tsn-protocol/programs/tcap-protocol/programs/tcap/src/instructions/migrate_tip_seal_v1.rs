use anchor_lang::prelude::*;

use crate::{authority::TCAP_GLOBAL_CONFIG_SEED, error::TcapError, state::{TcapGlobalConfigV1, TcapOneTimeTip}};

/// Adds the fixed-width seal head to an existing in-place TIP. The migration
/// never fabricates a balance: sealed and seal_commitment remain zero until a
/// client holding the owner seed submits the first sealed transition.
#[derive(Accounts)]
pub struct MigrateTipSealV1<'info> {
    #[account(mut, address = config.governance_authority @ TcapError::InvalidAuthority)]
    pub governance: Signer<'info>,
    #[account(seeds = [TCAP_GLOBAL_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, TcapGlobalConfigV1>,
    /// CHECK: validated as a program-owned legacy TIP and migrated in place.
    #[account(mut)]
    pub tip: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<MigrateTipSealV1>) -> Result<()> {
    let info = ctx.accounts.tip.to_account_info();
    require_keys_eq!(*info.owner, crate::ID, TcapError::InvalidPda);
    let old = info.try_borrow_data()?.to_vec();
    require!(old.len() >= 118, TcapError::InvalidPda);
    require!(old.len() < TcapOneTimeTip::SPACE, TcapError::TipSealAlreadyMigrated);
    let commitment: [u8; 32] = old[8..40].try_into().map_err(|_| error!(TcapError::InvalidPda))?;
    require!(commitment != [0; 32], TcapError::EmptyCommitment);
    info.realloc(TcapOneTimeTip::SPACE, false)?;
    let mut data = info.try_borrow_mut_data()?;
    data.fill(0);
    data[0..8].copy_from_slice(&old[0..8]);
    data[8..40].copy_from_slice(&old[8..40]);
    data[40..48].copy_from_slice(&old[40..48]);
    data[128..160].copy_from_slice(&old[48..80]);
    data[160..192].copy_from_slice(&old[80..112]);
    data[192..196].copy_from_slice(&old[112..116]);
    data[196] = old[116];
    data[197] = old[117];
    Ok(())
}
