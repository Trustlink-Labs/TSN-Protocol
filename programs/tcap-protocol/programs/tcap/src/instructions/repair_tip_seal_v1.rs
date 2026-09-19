use anchor_lang::prelude::*;

use crate::{authority::TCAP_GLOBAL_CONFIG_SEED, error::TcapError, state::{TcapGlobalConfigV1, TcapOneTimeTip}};

#[derive(Accounts)]
pub struct RepairTipSealV1<'info> {
    #[account(mut, address = config.governance_authority @ TcapError::InvalidAuthority)]
    pub governance: Signer<'info>,
    #[account(seeds = [TCAP_GLOBAL_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, TcapGlobalConfigV1>,
    /// CHECK: validated as the program-owned TIP with the known bad migrated layout.
    #[account(mut)]
    pub tip: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<RepairTipSealV1>) -> Result<()> {
    let info = ctx.accounts.tip.to_account_info();
    require_keys_eq!(*info.owner, crate::ID, TcapError::InvalidPda);
    let old = info.try_borrow_data()?.to_vec();
    require!(old.len() == TcapOneTimeTip::SPACE, TcapError::InvalidPda);
    require!(old[48..96].iter().all(|byte| *byte == 0), TcapError::TipSealAlreadyMigrated);
    require!(old[96..128].iter().any(|byte| *byte != 0), TcapError::InvalidPda);

    let mut data = info.try_borrow_mut_data()?;
    let policy = old[96..128].to_vec();
    let transition = old[128..160].to_vec();
    let token_id = old[160..164].to_vec();
    let consumed = old[164];
    let bump = old[165];
    data[48..128].fill(0);
    data[128..160].copy_from_slice(&policy);
    data[160..192].copy_from_slice(&transition);
    data[192..196].copy_from_slice(&token_id);
    data[196] = consumed;
    data[197] = bump;
    Ok(())
}
