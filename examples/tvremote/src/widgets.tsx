/**
 * Shared UI widgets for TV Remote:
 * D-Pad, remote action buttons, device cards, volume controls, app launch tiles.
 */
import { HostWidgetKind } from "@tenunjs/protocol";
import { jsx, type WidgetChild, type WidgetNode } from "@tenunjs/jsx-runtime";
import { Center, Column, Container, GestureDetector, Row, Text } from "@tenunjs/widgets";
import { TV_PALETTE } from "./theme";

export interface RemoteButtonProps {
  label: string;
  onPress?: () => void;
  onPressDown?: () => void;
  onPressUp?: () => void;
  color?: string;
  textColor?: string;
  width?: number;
  height?: number;
  radius?: number;
  disabled?: boolean;
}

export function RemoteButton(props: RemoteButtonProps): WidgetNode {
  const bg = props.disabled
    ? TV_PALETTE.card
    : props.color ?? TV_PALETTE.cardHighlight;
  const textColor = props.disabled
    ? TV_PALETTE.textMuted
    : props.textColor ?? TV_PALETTE.text;

  return (
    <GestureDetector
      onTap={props.disabled ? undefined : props.onPress}
      onLongPress={props.disabled ? undefined : props.onPressDown}
    >
      <Container
        color={bg}
        radius={props.radius ?? 12}
        width={props.width ?? 64}
        height={props.height ?? 48}
        borderColor={TV_PALETTE.border}
        borderWidth={1}
      >
        <Center>
          <Text variant="label" color={textColor}>
            {props.label}
          </Text>
        </Center>
      </Container>
    </GestureDetector>
  );
}

export interface DPadProps {
  onUp: () => void;
  onDown: () => void;
  onLeft: () => void;
  onRight: () => void;
  onCenter: () => void;
  onUpHoldStart?: () => void;
  onUpHoldEnd?: () => void;
  onDownHoldStart?: () => void;
  onDownHoldEnd?: () => void;
  onLeftHoldStart?: () => void;
  onLeftHoldEnd?: () => void;
  onRightHoldStart?: () => void;
  onRightHoldEnd?: () => void;
  disabled?: boolean;
}

export function DPad(props: DPadProps): WidgetNode {
  const btnSize = 56;
  const centerSize = 64;

  return (
    <Container
      color={TV_PALETTE.dpadBg}
      radius={110}
      width={220}
      height={220}
      borderColor={TV_PALETTE.border}
      borderWidth={2}
      shadow={4}
    >
      <Center>
        <Column gap={4}>
          {/* Top: UP */}
          <Row gap={0}>
            <Container width={btnSize} height={1} />
            <RemoteButton
              label="▲"
              width={btnSize}
              height={btnSize}
              radius={28}
              color={TV_PALETTE.dpadBtn}
              onPress={props.onUp}
              onPressDown={props.onUpHoldStart}
              onPressUp={props.onUpHoldEnd}
              disabled={props.disabled}
            />
            <Container width={btnSize} height={1} />
          </Row>

          {/* Middle: LEFT - CENTER - RIGHT */}
          <Row gap={4}>
            <RemoteButton
              label="◀"
              width={btnSize}
              height={btnSize}
              radius={28}
              color={TV_PALETTE.dpadBtn}
              onPress={props.onLeft}
              onPressDown={props.onLeftHoldStart}
              onPressUp={props.onLeftHoldEnd}
              disabled={props.disabled}
            />
            <RemoteButton
              label="OK"
              width={centerSize}
              height={centerSize}
              radius={32}
              color={TV_PALETTE.blue}
              textColor="#FFFFFF"
              onPress={props.onCenter}
              disabled={props.disabled}
            />
            <RemoteButton
              label="▶"
              width={btnSize}
              height={btnSize}
              radius={28}
              color={TV_PALETTE.dpadBtn}
              onPress={props.onRight}
              onPressDown={props.onRightHoldStart}
              onPressUp={props.onRightHoldEnd}
              disabled={props.disabled}
            />
          </Row>

          {/* Bottom: DOWN */}
          <Row gap={0}>
            <Container width={btnSize} height={1} />
            <RemoteButton
              label="▼"
              width={btnSize}
              height={btnSize}
              radius={28}
              color={TV_PALETTE.dpadBtn}
              onPress={props.onDown}
              onPressDown={props.onDownHoldStart}
              onPressUp={props.onDownHoldEnd}
              disabled={props.disabled}
            />
            <Container width={btnSize} height={1} />
          </Row>
        </Column>
      </Center>
    </Container>
  );
}

export interface VolumeRowProps {
  onVolDown: () => void;
  onMute: () => void;
  onVolUp: () => void;
  muted?: boolean;
  level?: number;
  max?: number;
  disabled?: boolean;
}

export function VolumeRow(props: VolumeRowProps): WidgetNode {
  const muteLabel = props.muted ? "MUTED" : "MUTE";
  const levelText =
    props.level !== undefined && props.max !== undefined
      ? `${props.level}/${props.max}`
      : "";

  return (
    <Row gap={12}>
      <RemoteButton
        label="VOL -"
        width={72}
        height={48}
        onPress={props.onVolDown}
        disabled={props.disabled}
      />
      <Container
        color={TV_PALETTE.card}
        radius={12}
        width={100}
        height={48}
        borderColor={TV_PALETTE.border}
        borderWidth={1}
      >
        <Center>
          <GestureDetector onTap={props.disabled ? undefined : props.onMute}>
            <Column gap={2}>
              <Text variant="caption" color={props.muted ? TV_PALETTE.red : TV_PALETTE.text}>
                {muteLabel}
              </Text>
              {levelText ? (
                <Text variant="caption" color={TV_PALETTE.textMuted}>
                  {levelText}
                </Text>
              ) : null}
            </Column>
          </GestureDetector>
        </Center>
      </Container>
      <RemoteButton
        label="VOL +"
        width={72}
        height={48}
        onPress={props.onVolUp}
        disabled={props.disabled}
      />
    </Row>
  );
}

export interface AppTileProps {
  name: string;
  color?: string;
  onLaunch: () => void;
  disabled?: boolean;
}

export function AppTile(props: AppTileProps): WidgetNode {
  return (
    <GestureDetector onTap={props.disabled ? undefined : props.onLaunch}>
      <Container
        color={props.color ?? TV_PALETTE.cardHighlight}
        radius={10}
        width={96}
        height={44}
        borderColor={TV_PALETTE.border}
        borderWidth={1}
      >
        <Center>
          <Text variant="label" color={TV_PALETTE.text}>
            {props.name}
          </Text>
        </Center>
      </Container>
    </GestureDetector>
  );
}
