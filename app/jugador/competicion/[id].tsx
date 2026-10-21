import {useLocalSearchParams} from 'expo-router';
import SportsApp from '@/src/ui/SportsApp';
export default function Competition(){const {id}=useLocalSearchParams<{id:string}>();return <SportsApp space="player" section="discover" competitionId={id}/>;}
