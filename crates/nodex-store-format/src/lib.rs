#![forbid(unsafe_code)]

pub const STORE_LINEAGE: &str = "nodex-rust-core";
pub const MIN_SUPPORTED_STORE_REVISION: u32 = 84;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PublishedStoreFormat {
    pub revision: u32,
    pub schema_fingerprint: &'static str,
}

pub const PUBLISHED_STORE_FORMATS: &[PublishedStoreFormat] = &[
    format(
        84,
        "be16a390d2be35a036cea413671b531ddbdb6b35d4c1acc24f1ce3dac473f659",
    ),
    format(
        85,
        "eee7d39ed280a961191aba2b19e9e218638d6f2e9d6fa3807d74807cbb675f2b",
    ),
    format(
        86,
        "9642837efeaa6f3701d8ec445c6294ecbe5c7186a41e84c50bd520261a5c3e00",
    ),
    format(
        87,
        "5e069cbccdab8938c2b0676e92eb109ac9e57bcccba7eb40965728140688bf75",
    ),
    format(
        88,
        "6e0e0883d80699deddbbc2e857212b048c9ddd58639c1260e993ac429ef2424f",
    ),
    format(
        89,
        "6e0e0883d80699deddbbc2e857212b048c9ddd58639c1260e993ac429ef2424f",
    ),
    format(
        90,
        "5ed6a9baa72223aae5fae81c92b335f7df976cd6cc676a61d4416a636de362ce",
    ),
    format(
        91,
        "c6cc471bbe04b3bcef872a921844561d8caf0e1b9faefaa6c592ca39ad35301d",
    ),
    format(
        92,
        "c6cc471bbe04b3bcef872a921844561d8caf0e1b9faefaa6c592ca39ad35301d",
    ),
    format(
        93,
        "2fa30de4e34ff3fa30e5ceeb8ed8bef39cbb716466ec32fa8460db32aaba3e60",
    ),
    format(
        94,
        "cb22ce09a3673bf14faf95d543f0208070b65a2d77be576a55295f4d5e649ae5",
    ),
    format(
        95,
        "31aa66b766d6144e38f7645d9226dca70dd22a7aea1cc8ade2bebd65acbe5f3d",
    ),
    format(
        96,
        "690e5e35242c18221571e261d4434a9a97c0262bc3e69791c27e07517077559f",
    ),
    format(
        97,
        "05176618a0c9db2f98044022888f8bf217f426f4f132e1d741168f20146a3cc9",
    ),
    format(
        98,
        "7b632a76b6649edbbf3a1ca40a2732576582d07fd321841397af6b30aa837541",
    ),
    format(
        99,
        "ef391c695b1360bc738714b8e4506bb37d6c24430f94cc65edd454abaf525151",
    ),
    format(
        100,
        "1da44f6990e48a3b5e80f4d3f464c6be52e927a777a5b8bb1f03be3de0d176a6",
    ),
    format(
        101,
        "58379bc7f98dbc857ee21a6453270a4c0b6f18265105c7dfad7004f2a3b32eb6",
    ),
    format(
        102,
        "c56d246e4d4b68ee40cc3c8e889e13dc82f23d2b970cf1a43ab37df95948f380",
    ),
    format(
        103,
        "7deff572411b6a148d49ae07411d4c333c2bb821abb2983c7e3fdacb7a9a9800",
    ),
    format(
        104,
        "7deff572411b6a148d49ae07411d4c333c2bb821abb2983c7e3fdacb7a9a9800",
    ),
    format(
        105,
        "9ad0f89aece0f783e9aaf8c7a8cb360413e8289430304b5cb0c243e9795490f2",
    ),
    format(
        106,
        "358843161ba6222ee89bb9000a6025145b477daa47ea8b5a5c7685b8787bc891",
    ),
    format(
        107,
        "21aa9712f987c67678e1df3911955b0f9a68a239993468fa11d49f26bb744d5e",
    ),
    format(
        108,
        "23655b4254aea59e3d264e9d74b5e45cb4292db3248617343c17cd18b44d82d9",
    ),
    format(
        109,
        "315a507e0c59326d2e6f0cb9eb8d44d13b61eebc235b56eeba82f3cf01aceead",
    ),
    format(
        110,
        "4bdd8d692330d7d15ab9f16fb1355df8d4829d5523563d8c71620b8f87ac9c14",
    ),
    format(
        111,
        "4bdd8d692330d7d15ab9f16fb1355df8d4829d5523563d8c71620b8f87ac9c14",
    ),
    format(
        112,
        "1692f75d0e6888ac4dcd6676c10f400fbf43a3214b858681d3ca385ef05635ab",
    ),
    format(
        113,
        "1692f75d0e6888ac4dcd6676c10f400fbf43a3214b858681d3ca385ef05635ab",
    ),
    format(
        114,
        "f5882e4f8cab2835d04c069ce7cfabdae3f57b69e74cf30419599f8eccee2f20",
    ),
    format(
        115,
        "74a4d09e3d03ccddcd23608ce3a2ebd76877bc97a1d488067c262dbeb4d92bf1",
    ),
    format(
        116,
        "5527ef57fdd477903667ec8f9fbad4e9899bba011bb9bcaf1771e46aa047b45f",
    ),
    format(
        117,
        "cf611cb3bd2c7bd50113f6dfda39dd448f7e38bd00f9ab09ad2c9ba05d2346e4",
    ),
    format(
        118,
        "cf814b86c73f184a76bc1a562505e9b514b58940c29fd15a323c3672de841caf",
    ),
    format(
        119,
        "7778a93bfa274ff9b009bd607d506a34118d1c925369cd6fabf11340d9601160",
    ),
    format(
        120,
        "44166b0a3992507de891cae82323fdb1090ffe2026289cdc1c70c2dde64dcc7d",
    ),
    format(
        121,
        "c9393a19379cb238cb806ec0d011e2ca0d95884a53c5844e42f9ffef44b0571f",
    ),
    format(
        122,
        "c9393a19379cb238cb806ec0d011e2ca0d95884a53c5844e42f9ffef44b0571f",
    ),
    format(
        123,
        "c9393a19379cb238cb806ec0d011e2ca0d95884a53c5844e42f9ffef44b0571f",
    ),
    format(
        124,
        "4f783db2d8600da7c579615efff106872d27659089d113bedfe7ded8c65758df",
    ),
    format(
        125,
        "8c893751d89fc3d0e4cba2f6cc274437cbcecd9682681037e481b1e04d155493",
    ),
    format(
        126,
        "9d43dad6763e168ed9b7a5afdaec2d91d7a4be8140f73d4702e33803947d307b",
    ),
    format(
        127,
        "dcc05f1811426f13cb92e8e7ef15bb9c945d774ec7c7ed2ef718c61c3e6c645b",
    ),
    format(
        128,
        "50026726a0257d6e2197d596641627b240e83f33256d1a327abf34864894a66c",
    ),
    format(
        129,
        "b27c7503d28ea3bc4f0a5ba452b881eaae006d59ed5a37131b2841a8bb296138",
    ),
];

pub const CURRENT_STORE_FORMAT: PublishedStoreFormat =
    PUBLISHED_STORE_FORMATS[PUBLISHED_STORE_FORMATS.len() - 1];
pub const CURRENT_STORE_VERSION: u32 = CURRENT_STORE_FORMAT.revision;
pub const CURRENT_STORE_SCHEMA_FINGERPRINT: &str = CURRENT_STORE_FORMAT.schema_fingerprint;

const fn format(revision: u32, schema_fingerprint: &'static str) -> PublishedStoreFormat {
    PublishedStoreFormat {
        revision,
        schema_fingerprint,
    }
}

pub fn published_store_format(revision: u32) -> Option<PublishedStoreFormat> {
    PUBLISHED_STORE_FORMATS
        .binary_search_by_key(&revision, |format| format.revision)
        .ok()
        .map(|index| PUBLISHED_STORE_FORMATS[index])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_is_contiguous_and_current_is_last() {
        let revisions = PUBLISHED_STORE_FORMATS
            .iter()
            .map(|format| format.revision)
            .collect::<Vec<_>>();
        assert_eq!(
            revisions,
            (MIN_SUPPORTED_STORE_REVISION..=CURRENT_STORE_FORMAT.revision).collect::<Vec<_>>()
        );
        assert_eq!(
            published_store_format(CURRENT_STORE_FORMAT.revision),
            Some(CURRENT_STORE_FORMAT)
        );
    }
}
