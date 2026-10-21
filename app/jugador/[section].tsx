import {useLocalSearchParams} from 'expo-router';
import SportsApp from '@/src/ui/SportsApp';
export default function PlayerPage(){const {section}=useLocalSearchParams<{section:string}>();return <SportsApp space="player" section={section}/>;}
