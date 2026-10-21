import {useLocalSearchParams} from 'expo-router';
import SportsApp from '@/src/ui/SportsApp';
export default function Competition(){const {id}=useLocalSearchParams<{id:string}>();return <SportsApp space="organizer" section="competitions" competitionId={id}/>;}
