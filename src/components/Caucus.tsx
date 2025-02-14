import * as React from 'react';
import firebase from 'firebase/app';
import {
  Segment, Dropdown, TextArea, Input, Grid, Feed,
  Label, Form, Container
} from 'semantic-ui-react';
import { Helmet } from 'react-helmet';
import Timer, { TimerData, DEFAULT_TIMER } from './Timer';
import { RouteComponentProps } from 'react-router';
import { CommitteeData, recoverMembers, recoverSettings, recoverCaucus } from './Committee';
import CaucusQueuer from './caucus/CaucusQueuer';
import { textAreaHandler, dropdownHandler, fieldHandler } from '../actions/handlers';
import { makeDropdownOption, isOwner } from '../utils';
import { URLParameters } from '../types';
import { CaucusNextSpeaking } from './caucus/CaucusNextSpeaking';
import { SpeakerEvent, SpeakerFeedEntry } from './caucus/SpeakerFeed';
import { NotFound } from './NotFound';
import { Unit } from './TimerSetter';

export const DEFAULT_CAUCUS_TIME_SECONDS = 10 * 60;
export const DEFAULT_SPEAKER_TIME_SECONDS = 1 * 60;

export function recoverUnit(caucus?: CaucusData): Unit {
  return caucus ? (caucus.speakerUnit || Unit.Seconds) : Unit.Seconds;
}

export function recoverDuration(caucus?: CaucusData): number | undefined {
  return caucus
    ? caucus.speakerDuration
      ? caucus.speakerDuration
      : undefined
    : undefined;
}

interface Props extends RouteComponentProps<URLParameters> {
}

interface State {
  speakerTimer: TimerData;
  caucusTimer: TimerData;
  committee?: CommitteeData;
  committeeFref: firebase.database.Reference;
  loading: boolean;
  isOwner: boolean;
}

export type CaucusID = string;

export enum CaucusStatus {
  Open = 'Open',
  Closed = 'Closed'
}

export interface CaucusData {
  name: string;
  topic: string;
  status: CaucusStatus;
  speakerTimer: TimerData;
  speakerDuration?: number; // TODO: Migrate
  speakerUnit?: Unit; // TODO: Migrate
  caucusTimer: TimerData;
  queueIsPublic?: boolean; // TODO: Migrate
  speaking?: SpeakerEvent;
  queue?: Record<string, SpeakerEvent>;
  history?: Record<string, SpeakerEvent>;
}

const CAUCUS_STATUS_OPTIONS = [
  CaucusStatus.Open,
  CaucusStatus.Closed
].map(makeDropdownOption);

export const DEFAULT_CAUCUS: CaucusData = {
  name: 'untitled caucus',
  topic: '',
  status: CaucusStatus.Open,
  speakerTimer: { ...DEFAULT_TIMER, remaining: DEFAULT_SPEAKER_TIME_SECONDS },
  speakerDuration: DEFAULT_SPEAKER_TIME_SECONDS,
  speakerUnit: Unit.Seconds,
  caucusTimer: { ...DEFAULT_TIMER, remaining: DEFAULT_CAUCUS_TIME_SECONDS },
  queueIsPublic: false,
  queue: {} as Record<string, SpeakerEvent>,
  history: {} as Record<string, SpeakerEvent>,
};

export default class Caucus extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);

    const { match } = props;

    const committee = firebase.database().ref('committees').child(match.params.committeeID);
    const user = firebase.auth().currentUser
    console.log("current user is: ");
    console.log(user);
    
    this.state = {
      committeeFref: committee,
      caucusTimer: DEFAULT_CAUCUS.caucusTimer,
      speakerTimer: DEFAULT_CAUCUS.speakerTimer,
      loading: true,
      isOwner: false,
    };
  }

  firebaseCallback = (committee: firebase.database.DataSnapshot | null) => {
    if (committee) {
      this.setState({ committee: committee.val(), loading: false });
    }
    const user = firebase.auth().currentUser;
    if (user) {
      this.setState({ isOwner: isOwner(this.state.committee, user)});
    }
  }

  // XXX: I'm worried that this might be the source of a bug that I'm yet to observe
  // Say our route changes the committeeID, _but does not unmount the caucus component_
  // Will these listeners be purged?
  componentDidMount() {
    this.state.committeeFref.on('value', this.firebaseCallback);
  }

  componentWillUnmount() {
    this.state.committeeFref.off('value', this.firebaseCallback);
  }

  recoverCaucusFref = () => {
    const caucusID: CaucusID = this.props.match.params.caucusID;

    return this.state.committeeFref
      .child('caucuses')
      .child(caucusID);
  }

  renderHeader = (caucus?: CaucusData) => {
    const caucusFref = this.recoverCaucusFref();

    const statusDropdown = (
      <Dropdown 
        value={caucus ? caucus.status : CaucusStatus.Open} 
        options={CAUCUS_STATUS_OPTIONS} 
        onChange={dropdownHandler<CaucusData>(caucusFref, 'status')} 
      /> 
    );

    return (
      <>
        <Input
          label={statusDropdown}
          labelPosition="right"
          value={caucus ? caucus.name : ''}
          onChange={fieldHandler<CaucusData>(caucusFref, 'name')}
          loading={!caucus}
          attatched="top"
          size="massive"
          fluid
          placeholder="Set caucus name"
        />
        <Form loading={!caucus}>
          <TextArea
            value={caucus ? caucus.topic : ''}
            autoHeight
            onChange={textAreaHandler<CaucusData>(caucusFref, 'topic')}
            attatched="top"
            rows={1}
            placeholder="Set caucus details"
          />
        </Form>
      </>
    );
  }

  renderNowSpeaking =  (caucus?: CaucusData) => {
    const { speakerTimer, isOwner } = this.state;
    
    const caucusFref = this.recoverCaucusFref();

    const entryData = caucus ? caucus.speaking : undefined;

    return (
      <Segment loading={!caucus}>
        <Label attached="top left" size="large">Now speaking</Label>
        <Feed size="large" disabled={!isOwner}>
          <SpeakerFeedEntry 
            data={entryData} 
            fref={caucusFref.child('speaking')}
            speaking={caucus ? caucus.speaking : undefined}
            speakerTimer={speakerTimer}
            owner={isOwner}
          />
        </Feed>
      </Segment>
    );
  }

  setSpeakerTimer = (timer: TimerData) => {
    this.setState({ speakerTimer: timer });
  }

  setCaucusTimer = (timer: TimerData) => {
    this.setState({ caucusTimer: timer });
  }

  renderCaucus = (caucus?: CaucusData) => {
    const { renderNowSpeaking, renderHeader, recoverCaucusFref } = this;
    const { speakerTimer, committee, isOwner } = this.state;

    const { caucusID } = this.props.match.params;
    const caucusFref = recoverCaucusFref();

    const members = recoverMembers(committee);

    const renderedSpeakerTimer = (
      <Timer
        name="Speaker timer"
        timerFref={caucusFref.child('speakerTimer')}
        key={caucusID + 'speakerTimer'}
        onChange={this.setSpeakerTimer}
        toggleKeyCode={83} // S - if changing this, update Help
        defaultUnit={recoverUnit(caucus)}
        defaultDuration={recoverDuration(caucus) || 60}
        isOwner={isOwner}
      />
    );

    const renderedCaucusTimer = (
      <Timer
        name="Caucus timer"
        timerFref={caucusFref.child('caucusTimer')}
        key={caucusID + 'caucusTimer'}
        onChange={this.setCaucusTimer}
        toggleKeyCode={67} // C - if changing this, update Help
        defaultUnit={Unit.Minutes}
        defaultDuration={10}
        isOwner={isOwner}
      />
    );

    const { 
      autoNextSpeaker, 
      timersInSeparateColumns, 
      moveQueueUp 
    } = recoverSettings(committee);

    const header = (
      <Grid.Row>
        <Grid.Column>
          {renderHeader(caucus)}
        </Grid.Column>
      </Grid.Row>
    );

    const renderedCaucusQueuer = (
      <CaucusQueuer 
        caucus={caucus} 
        members={members} 
        caucusFref={caucusFref}
        isOwner={isOwner}
      />
    );

    const renderedCaucusNextSpeaking = (
      <CaucusNextSpeaking 
        caucus={caucus} 
        fref={caucusFref} 
        speakerTimer={speakerTimer} 
        autoNextSpeaker={autoNextSpeaker}
        owner={isOwner}
      />
    );

    const body = !timersInSeparateColumns ? (
      <Grid.Row>
        <Grid.Column>
          {renderNowSpeaking(caucus)}
          {moveQueueUp && renderedCaucusQueuer}
          {renderedCaucusNextSpeaking}
          {!moveQueueUp && renderedCaucusQueuer}
        </Grid.Column>
        <Grid.Column>
          {renderedSpeakerTimer}
          {renderedCaucusTimer}
        </Grid.Column>
      </Grid.Row>
    ) : (
      <Grid.Row>
        <Grid.Column>
          {renderedSpeakerTimer}
          {renderNowSpeaking(caucus)}
          {renderedCaucusNextSpeaking}
        </Grid.Column>
        <Grid.Column>
          {renderedCaucusTimer}
          {renderedCaucusQueuer}
        </Grid.Column>
      </Grid.Row>
    );

    return (
      <Container style={{ 'padding-bottom': '2em' }}>
        <Helmet>
          <title>{`${caucus?.name} - Muncoordinated`}</title>
        </Helmet>
        <Grid columns="equal" stackable>
          {header}
          {body}
        </Grid >
      </Container>
    );
  }

  render() {
    const { committee, loading } = this.state;
    const caucusID: CaucusID = this.props.match.params.caucusID;

    const caucus = recoverCaucus(committee, caucusID);

    if (!loading && !caucus) {
      return (
        <Container text style={{ 'padding-bottom': '2em' }}>
          <NotFound item="caucus" id={caucusID} />
        </Container>
      );
    } else {
      return this.renderCaucus(caucus);
    }
  }
}
