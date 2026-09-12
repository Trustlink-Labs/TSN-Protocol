use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;

use crate::tsn::constants::TSN_TRUSTLINK_INTENT_DOMAIN_TAG;

pub fn compute_cranker_dna(mother_escrow: &Pubkey, operator: &Pubkey, protocol_seed: &[u8; 32]) -> [u8; 32] {
    hashv(&[
        b"tsn_dna",
        mother_escrow.as_ref(),
        operator.as_ref(),
        protocol_seed,
    ])
    .to_bytes()
}

pub fn compute_tsn_domain(tsn_vault_pubkey: &Pubkey) -> [u8; 32] {
    hashv(&[
        TSN_TRUSTLINK_INTENT_DOMAIN_TAG,
        tsn_vault_pubkey.as_ref(),
    ])
    .to_bytes()
}

