use anchor_lang::prelude::*;
use crate::{authority::TCAP_GLOBAL_CONFIG_SEED, error::TcapError, state::{TcapGlobalConfigV1,TcapOneTimeTip,TcapReserveStateV1,TcapTipLiabilityV2,TcapExitPermitV1}};

pub const EXIT_PERMIT_SEED: &[u8] = b"tcap:exit-permit:v1";

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct DebitTcapExitArgsV1 { pub permit_nonce:[u8;32], pub destination_commitment:[u8;32], pub mint: Pubkey, pub amount:u64, pub sequence:u64, pub sealed:[u8;48], pub seal_commitment:[u8;32], pub source_debit_signature:[u8;64] }

#[derive(Accounts)]
#[instruction(args: DebitTcapExitArgsV1)]
pub struct DebitTcapExitV1<'info> {
    #[account(mut)] pub authority: Signer<'info>,
    #[account(seeds=[TCAP_GLOBAL_CONFIG_SEED], bump=config.bump, constraint=!config.paused @ TcapError::ProtocolPaused)] pub config: Account<'info,TcapGlobalConfigV1>,
    #[account(mut)] pub current_tip: Account<'info,TcapOneTimeTip>,
    #[account(mut)] pub reserve_state: Account<'info,TcapReserveStateV1>,
    #[account(mut, constraint=liability.tip==current_tip.key() @ TcapError::InvalidTipLiability)] pub liability: Account<'info,TcapTipLiabilityV2>,
    #[account(init, payer=authority, space=TcapExitPermitV1::SPACE, seeds=[EXIT_PERMIT_SEED,args.permit_nonce.as_ref()], bump)] pub permit: Account<'info,TcapExitPermitV1>,
    pub system_program: Program<'info,System>,
}

pub fn handler(ctx: Context<DebitTcapExitV1>, args: DebitTcapExitArgsV1) -> Result<()> {
    require!(args.amount>0 && args.permit_nonce != [0;32], TcapError::InvalidDepositAmount);
    require!(args.sealed != [0;48] && args.seal_commitment != [0;32], TcapError::TipSealRequired);
    require!(args.sequence == ctx.accounts.current_tip.sequence.checked_add(1).ok_or(TcapError::ArithmeticOverflow)?, TcapError::InvalidTipSequence);
    require!(ctx.accounts.liability.available >= args.amount, TcapError::InsufficientConfidentialBalance);
    let permit = &mut ctx.accounts.permit;
    permit.tip=ctx.accounts.current_tip.key(); permit.destination_commitment=args.destination_commitment; permit.mint=args.mint; permit.amount=args.amount; permit.sequence=args.sequence; permit.nonce=args.permit_nonce; permit.source_debit_signature=args.source_debit_signature; permit.consumed=false; permit.bump=ctx.bumps.permit;
    let tip=&mut ctx.accounts.current_tip; tip.sequence=args.sequence; tip.transition_nullifier=args.permit_nonce; tip.sealed=args.sealed; tip.seal_commitment=args.seal_commitment;
    ctx.accounts.liability.available=ctx.accounts.liability.available.checked_sub(args.amount).ok_or(TcapError::ArithmeticOverflow)?;
    ctx.accounts.liability.spent=ctx.accounts.liability.spent.checked_add(args.amount).ok_or(TcapError::ArithmeticOverflow)?;
    ctx.accounts.reserve_state.settled_confidential_liabilities=ctx.accounts.reserve_state.settled_confidential_liabilities.checked_sub(args.amount).ok_or(TcapError::ArithmeticOverflow)?;
    Ok(())
}
