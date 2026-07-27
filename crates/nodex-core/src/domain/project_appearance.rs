use std::sync::LazyLock;

use nodex_core_contracts::workspace::{
    ProjectAppearance, ProjectMarker, ProjectMarkerColor, ProjectMarkerIcon,
};
use unicode_segmentation::UnicodeSegmentation;

pub(crate) const MAX_PROJECT_EMOJI_BYTES: usize = 256;

static EXTENDED_PICTOGRAPHIC: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"\p{Extended_Pictographic}")
        .expect("Extended_Pictographic is a supported Unicode property")
});

pub(crate) fn normalize_project_appearance(
    appearance: &ProjectAppearance,
) -> Result<ProjectAppearance, &'static str> {
    let marker = match &appearance.marker {
        ProjectMarker::Icon { icon } => ProjectMarker::Icon { icon: *icon },
        ProjectMarker::Emoji { emoji } => ProjectMarker::Emoji {
            emoji: normalize_project_emoji(emoji)?,
        },
    };
    Ok(ProjectAppearance {
        color: appearance.color,
        marker,
    })
}

pub(crate) fn project_appearance_from_storage(
    color: &str,
    marker_kind: &str,
    marker_value: &str,
) -> Result<ProjectAppearance, &'static str> {
    let color = project_marker_color_from_literal(color)?;
    let marker = match marker_kind {
        "icon" => ProjectMarker::Icon {
            icon: project_marker_icon_from_literal(marker_value)?,
        },
        "emoji" => {
            let emoji = normalize_project_emoji(marker_value)?;
            if emoji != marker_value {
                return Err("stored Project emoji marker is not canonical");
            }
            ProjectMarker::Emoji { emoji }
        }
        _ => return Err("stored Project marker kind is invalid"),
    };
    Ok(ProjectAppearance { color, marker })
}

pub(crate) fn legacy_project_appearance(icon: &str) -> ProjectAppearance {
    normalize_project_emoji(icon).map_or_else(
        |_| ProjectAppearance::default(),
        |emoji| ProjectAppearance {
            color: ProjectMarkerColor::Black,
            marker: ProjectMarker::Emoji { emoji },
        },
    )
}

pub(crate) fn normalize_project_emoji(value: &str) -> Result<String, &'static str> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > MAX_PROJECT_EMOJI_BYTES
        || value.chars().any(char::is_control)
    {
        return Err("Project emoji marker is invalid");
    }
    value
        .graphemes(true)
        .find(|grapheme| EXTENDED_PICTOGRAPHIC.is_match(grapheme))
        .map(str::to_owned)
        .ok_or("Project emoji marker must contain an emoji")
}

pub(crate) fn project_marker_color_literal(color: ProjectMarkerColor) -> &'static str {
    match color {
        ProjectMarkerColor::Black => "black",
        ProjectMarkerColor::Red => "red",
        ProjectMarkerColor::Orange => "orange",
        ProjectMarkerColor::Yellow => "yellow",
        ProjectMarkerColor::Green => "green",
        ProjectMarkerColor::Blue => "blue",
        ProjectMarkerColor::Purple => "purple",
        ProjectMarkerColor::Pink => "pink",
    }
}

pub(crate) fn project_marker_icon_literal(icon: ProjectMarkerIcon) -> &'static str {
    match icon {
        ProjectMarkerIcon::Folder => "folder",
        ProjectMarkerIcon::CurrencyDollar => "currency-dollar",
        ProjectMarkerIcon::Book => "book",
        ProjectMarkerIcon::GraduationCap => "graduation-cap",
        ProjectMarkerIcon::Edit => "edit",
        ProjectMarkerIcon::Writing => "writing",
        ProjectMarkerIcon::Function => "function",
        ProjectMarkerIcon::Terminal => "terminal",
        ProjectMarkerIcon::Music => "music",
        ProjectMarkerIcon::Popcorn => "popcorn",
        ProjectMarkerIcon::Customize => "customize",
        ProjectMarkerIcon::Palette => "palette",
        ProjectMarkerIcon::Stethoscope => "stethoscope",
        ProjectMarkerIcon::Health => "health",
        ProjectMarkerIcon::Lotus => "lotus",
        ProjectMarkerIcon::Suitcase => "suitcase",
        ProjectMarkerIcon::BarChart => "bar-chart",
        ProjectMarkerIcon::Kettlebell => "kettlebell",
        ProjectMarkerIcon::Dumbbell => "dumbbell",
        ProjectMarkerIcon::Logs => "logs",
        ProjectMarkerIcon::Scale => "scale",
        ProjectMarkerIcon::DeskGlobe => "desk-globe",
        ProjectMarkerIcon::Plane => "plane",
        ProjectMarkerIcon::Globe => "globe",
        ProjectMarkerIcon::Wrench => "wrench",
        ProjectMarkerIcon::Paw => "paw",
        ProjectMarkerIcon::Flask => "flask",
        ProjectMarkerIcon::Brain => "brain",
        ProjectMarkerIcon::Heart => "heart",
        ProjectMarkerIcon::Plant => "plant",
    }
}

fn project_marker_color_from_literal(value: &str) -> Result<ProjectMarkerColor, &'static str> {
    match value {
        "black" => Ok(ProjectMarkerColor::Black),
        "red" => Ok(ProjectMarkerColor::Red),
        "orange" => Ok(ProjectMarkerColor::Orange),
        "yellow" => Ok(ProjectMarkerColor::Yellow),
        "green" => Ok(ProjectMarkerColor::Green),
        "blue" => Ok(ProjectMarkerColor::Blue),
        "purple" => Ok(ProjectMarkerColor::Purple),
        "pink" => Ok(ProjectMarkerColor::Pink),
        _ => Err("stored Project marker color is invalid"),
    }
}

fn project_marker_icon_from_literal(value: &str) -> Result<ProjectMarkerIcon, &'static str> {
    match value {
        "folder" => Ok(ProjectMarkerIcon::Folder),
        "currency-dollar" => Ok(ProjectMarkerIcon::CurrencyDollar),
        "book" => Ok(ProjectMarkerIcon::Book),
        "graduation-cap" => Ok(ProjectMarkerIcon::GraduationCap),
        "edit" => Ok(ProjectMarkerIcon::Edit),
        "writing" => Ok(ProjectMarkerIcon::Writing),
        "function" => Ok(ProjectMarkerIcon::Function),
        "terminal" => Ok(ProjectMarkerIcon::Terminal),
        "music" => Ok(ProjectMarkerIcon::Music),
        "popcorn" => Ok(ProjectMarkerIcon::Popcorn),
        "customize" => Ok(ProjectMarkerIcon::Customize),
        "palette" => Ok(ProjectMarkerIcon::Palette),
        "stethoscope" => Ok(ProjectMarkerIcon::Stethoscope),
        "health" => Ok(ProjectMarkerIcon::Health),
        "lotus" => Ok(ProjectMarkerIcon::Lotus),
        "suitcase" => Ok(ProjectMarkerIcon::Suitcase),
        "bar-chart" => Ok(ProjectMarkerIcon::BarChart),
        "kettlebell" => Ok(ProjectMarkerIcon::Kettlebell),
        "dumbbell" => Ok(ProjectMarkerIcon::Dumbbell),
        "logs" => Ok(ProjectMarkerIcon::Logs),
        "scale" => Ok(ProjectMarkerIcon::Scale),
        "desk-globe" => Ok(ProjectMarkerIcon::DeskGlobe),
        "plane" => Ok(ProjectMarkerIcon::Plane),
        "globe" => Ok(ProjectMarkerIcon::Globe),
        "wrench" => Ok(ProjectMarkerIcon::Wrench),
        "paw" => Ok(ProjectMarkerIcon::Paw),
        "flask" => Ok(ProjectMarkerIcon::Flask),
        "brain" => Ok(ProjectMarkerIcon::Brain),
        "heart" => Ok(ProjectMarkerIcon::Heart),
        "plant" => Ok(ProjectMarkerIcon::Plant),
        _ => Err("stored Project marker icon is invalid"),
    }
}

#[cfg(test)]
mod tests {
    use nodex_core_contracts::workspace::{
        ProjectAppearance, ProjectMarker, ProjectMarkerColor, ProjectMarkerIcon,
    };

    use super::{
        legacy_project_appearance, normalize_project_appearance, project_appearance_from_storage,
        project_marker_color_literal, project_marker_icon_literal,
    };

    #[test]
    fn every_canonical_color_and_icon_round_trips_through_storage() {
        let colors = [
            ProjectMarkerColor::Black,
            ProjectMarkerColor::Red,
            ProjectMarkerColor::Orange,
            ProjectMarkerColor::Yellow,
            ProjectMarkerColor::Green,
            ProjectMarkerColor::Blue,
            ProjectMarkerColor::Purple,
            ProjectMarkerColor::Pink,
        ];
        let icons = [
            ProjectMarkerIcon::Folder,
            ProjectMarkerIcon::CurrencyDollar,
            ProjectMarkerIcon::Book,
            ProjectMarkerIcon::GraduationCap,
            ProjectMarkerIcon::Edit,
            ProjectMarkerIcon::Writing,
            ProjectMarkerIcon::Function,
            ProjectMarkerIcon::Terminal,
            ProjectMarkerIcon::Music,
            ProjectMarkerIcon::Popcorn,
            ProjectMarkerIcon::Customize,
            ProjectMarkerIcon::Palette,
            ProjectMarkerIcon::Stethoscope,
            ProjectMarkerIcon::Health,
            ProjectMarkerIcon::Lotus,
            ProjectMarkerIcon::Suitcase,
            ProjectMarkerIcon::BarChart,
            ProjectMarkerIcon::Kettlebell,
            ProjectMarkerIcon::Dumbbell,
            ProjectMarkerIcon::Logs,
            ProjectMarkerIcon::Scale,
            ProjectMarkerIcon::DeskGlobe,
            ProjectMarkerIcon::Plane,
            ProjectMarkerIcon::Globe,
            ProjectMarkerIcon::Wrench,
            ProjectMarkerIcon::Paw,
            ProjectMarkerIcon::Flask,
            ProjectMarkerIcon::Brain,
            ProjectMarkerIcon::Heart,
            ProjectMarkerIcon::Plant,
        ];
        for color in colors {
            let literal = project_marker_color_literal(color);
            let appearance =
                project_appearance_from_storage(literal, "icon", "folder").expect("stored color");
            assert_eq!(appearance.color, color);
        }
        for icon in icons {
            let literal = project_marker_icon_literal(icon);
            let appearance =
                project_appearance_from_storage("black", "icon", literal).expect("stored icon");
            assert_eq!(appearance.marker, ProjectMarker::Icon { icon });
        }
    }

    #[test]
    fn normalizes_one_extended_pictographic_grapheme() {
        let appearance = normalize_project_appearance(&ProjectAppearance {
            color: ProjectMarkerColor::Pink,
            marker: ProjectMarker::Emoji {
                emoji: "  Build 👩🏽‍💻 now  ".to_owned(),
            },
        })
        .expect("appearance");
        assert_eq!(
            appearance,
            ProjectAppearance {
                color: ProjectMarkerColor::Pink,
                marker: ProjectMarker::Emoji {
                    emoji: "👩🏽‍💻".to_owned(),
                },
            }
        );
    }

    #[test]
    fn rejects_non_emoji_and_noncanonical_storage() {
        assert!(
            normalize_project_appearance(&ProjectAppearance {
                color: ProjectMarkerColor::Black,
                marker: ProjectMarker::Emoji {
                    emoji: "plain text".to_owned(),
                },
            })
            .is_err()
        );
        assert!(project_appearance_from_storage("black", "emoji", "🚀 launch").is_err());
    }

    #[test]
    fn legacy_values_preserve_valid_emoji_and_default_everything_else() {
        assert_eq!(
            legacy_project_appearance("Launch 🚀 now").marker,
            ProjectMarker::Emoji {
                emoji: "🚀".to_owned(),
            }
        );
        assert_eq!(
            legacy_project_appearance("not an emoji"),
            ProjectAppearance::default()
        );
        assert_eq!(
            legacy_project_appearance(""),
            ProjectAppearance {
                color: ProjectMarkerColor::Black,
                marker: ProjectMarker::Icon {
                    icon: ProjectMarkerIcon::Folder,
                },
            }
        );
    }
}
