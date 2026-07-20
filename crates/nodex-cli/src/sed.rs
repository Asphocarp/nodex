use crate::error::{CliError, CliErrorCode};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LineRange {
    pub start: usize,
    pub end: usize,
}

pub fn parse_program(program: &str) -> Result<LineRange, CliError> {
    let Some(address) = program.strip_suffix('p') else {
        return Err(invalid_program());
    };
    if address.is_empty() || address.contains(|character: char| character.is_whitespace()) {
        return Err(invalid_program());
    }
    let mut parts = address.split(',');
    let start = parse_positive_line(parts.next().unwrap_or_default())?;
    let end = match parts.next() {
        Some(end) => parse_positive_line(end)?,
        None => start,
    };
    if parts.next().is_some() || end < start {
        return Err(invalid_program());
    }
    Ok(LineRange { start, end })
}

pub fn select_lines(body: &str, range: LineRange) -> String {
    body.split_inclusive('\n')
        .enumerate()
        .filter_map(|(index, line)| {
            let line_number = index + 1;
            (line_number >= range.start && line_number <= range.end).then_some(line)
        })
        .collect()
}

fn parse_positive_line(value: &str) -> Result<usize, CliError> {
    let line = value.parse::<usize>().map_err(|_| invalid_program())?;
    if line == 0 {
        return Err(invalid_program());
    }
    Ok(line)
}

fn invalid_program() -> CliError {
    CliError::new(
        CliErrorCode::InvalidInput,
        "sed accepts only one positive '<start>[,<end>]p' program",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_one_line_and_inclusive_ranges() {
        assert_eq!(parse_program("2p").unwrap(), LineRange { start: 2, end: 2 });
        assert_eq!(
            parse_program("2,4p").unwrap(),
            LineRange { start: 2, end: 4 }
        );
    }

    #[test]
    fn rejects_mutating_or_non_numeric_sed_programs() {
        for program in ["s/a/b/", "1,2d", "0p", "3,2p", "/x/p", "1p;2p"] {
            assert!(parse_program(program).is_err(), "{program} must fail");
        }
    }

    #[test]
    fn range_past_eof_prints_its_intersection() {
        let selected = select_lines("one\ntwo\nthree\n", LineRange { start: 2, end: 99 });
        assert_eq!(selected, "two\nthree\n");
    }
}
